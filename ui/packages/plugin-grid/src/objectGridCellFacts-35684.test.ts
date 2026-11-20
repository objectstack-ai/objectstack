/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The cell facts `ObjectGrid` hands the select-first table
 * (objectstack#35684, objectstack#35687): the reason order, what typing does
 * per field type, and what pasted text stands for in a choice field.
 */
import { describe, it, expect } from 'vitest';
import { cellReadOnlyKind, inlineTyping, choiceFromText, type CellReadOnlyInputs } from './objectGridCellFacts';
import { fieldInlineReadOnlyKind, isFieldInlineEditable } from './inline-edit-options';

const OPEN: CellReadOnlyInputs = {
  fieldDef: { type: 'text' },
  fieldWritable: true,
  gridEditable: true,
  objectEditable: true,
  canUpdate: true,
  approvalLocked: false,
  recordUpdate: true,
};

describe('cellReadOnlyKind — the reason a cell names (objectstack#35684)', () => {
  it('names none for a cell that edits, and none while the record verdict is unknown', () => {
    expect(cellReadOnlyKind(OPEN)).toBeNull();
    expect(cellReadOnlyKind({ ...OPEN, recordUpdate: undefined })).toBeNull();
  });

  it('names each reason alone', () => {
    expect(cellReadOnlyKind({ ...OPEN, fieldDef: { type: 'text', readonly: true } })).toBe('readonly');
    expect(cellReadOnlyKind({ ...OPEN, fieldDef: { type: 'autonumber' } })).toBe('computed');
    expect(cellReadOnlyKind({ ...OPEN, fieldDef: { type: 'text', expression: 'a + b' } as never })).toBe('computed');
    expect(cellReadOnlyKind({ ...OPEN, fieldDef: { type: 'file' } })).toBe('notInline');
    expect(cellReadOnlyKind({ ...OPEN, fieldWritable: false })).toBe('noFieldPermission');
    expect(cellReadOnlyKind({ ...OPEN, canUpdate: false, objectEditable: false })).toBe('noPermission');
    expect(cellReadOnlyKind({ ...OPEN, objectEditable: false })).toBe('objectReadOnly');
    expect(cellReadOnlyKind({ ...OPEN, gridEditable: false })).toBe('viewOff');
    expect(cellReadOnlyKind({ ...OPEN, approvalLocked: true })).toBe('approvalLocked');
    expect(cellReadOnlyKind({ ...OPEN, recordUpdate: false })).toBe('noRecordPermission');
  });

  it("puts the field's reason first, then the grid's, then the record's", () => {
    const all: CellReadOnlyInputs = {
      fieldDef: { type: 'formula' },
      fieldWritable: false,
      gridEditable: false,
      objectEditable: false,
      canUpdate: false,
      approvalLocked: true,
      recordUpdate: false,
    };
    expect(cellReadOnlyKind(all)).toBe('computed');
    expect(cellReadOnlyKind({ ...all, fieldDef: { type: 'text' } })).toBe('noFieldPermission');
    expect(cellReadOnlyKind({ ...all, fieldDef: { type: 'text' }, fieldWritable: true })).toBe('noPermission');
    expect(cellReadOnlyKind({ ...OPEN, gridEditable: false, approvalLocked: true })).toBe('viewOff');
    expect(cellReadOnlyKind({ ...OPEN, approvalLocked: true, recordUpdate: false })).toBe('approvalLocked');
  });

  it('isFieldInlineEditable is the same answer, read as a yes / no', () => {
    for (const def of [null, { type: 'text' }, { type: 'text', readonly: true }, { type: 'rollup' }, { type: 'signature' }, { type: 'select' }]) {
      expect(isFieldInlineEditable(def)).toBe(fieldInlineReadOnlyKind(def) === null);
    }
  });
});

describe('inlineTyping — what a typed key does (objectstack#35687)', () => {
  it('replaces the value of a text or a figure, and opens a picker or a date over it', () => {
    for (const type of ['text', 'textarea', 'email', 'url', 'phone', 'number', 'currency', 'percent']) {
      expect(inlineTyping(type)).toBe('replace');
    }
    for (const type of ['select', 'lookup', 'user', 'date', 'datetime', 'boolean', 'multiselect']) {
      expect(inlineTyping(type)).toBe('open');
    }
    expect(inlineTyping(undefined)).toBeUndefined();
  });
});

describe('choiceFromText — pasted text in a choice field (objectstack#35687)', () => {
  const options = [{ label: 'High', value: 'high' }, { label: 'Low', value: 'low' }];

  it('a single choice takes the option the text names, by value or label', () => {
    const read = choiceFromText({ type: 'select', options })!;
    expect(read('High')).toBe('high');
    expect(read(' low\n')).toBe('low');
    expect(read('Medium')).toBeUndefined();
  });

  it('a multiple choice takes every option of a list, or nothing', () => {
    const read = choiceFromText({ type: 'multiselect', options })!;
    expect(read('high, Low')).toEqual(['high', 'low']);
    expect(read('high, medium')).toBeUndefined();
  });

  it('a record reference takes nothing, and any other type is left to the table', () => {
    expect(choiceFromText({ type: 'lookup' })!('Acme')).toBeUndefined();
    expect(choiceFromText({ type: 'text' })).toBeNull();
    expect(choiceFromText(undefined)).toBeNull();
  });
});
