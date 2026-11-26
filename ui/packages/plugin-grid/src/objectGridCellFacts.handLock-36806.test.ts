/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * #36806 — grid inline edit reads the hand lock. A `uiReadonly` column names
 * the `readonly` reason; a `uiReadonlyWhen` column names it on the rows its
 * predicate is TRUE over and edits on the others. The cell gate is the one
 * the data table's paste and multi-row staging read (`readOnlyReasonOf`), so
 * the multi-row save is locked by the same verdict.
 */
import { describe, it, expect } from 'vitest';
import { cellReadOnlyKind, type CellReadOnlyInputs } from './objectGridCellFacts';
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

describe('grid hand lock (#36806)', () => {
  it('a uiReadonly column is read-only with the readonly reason', () => {
    expect(fieldInlineReadOnlyKind({ type: 'text', uiReadonly: true })).toBe('readonly');
    expect(isFieldInlineEditable({ type: 'text', uiReadonly: true })).toBe(false);
    expect(cellReadOnlyKind({ ...OPEN, fieldDef: { type: 'text', uiReadonly: true } })).toBe('readonly');
  });

  it('a uiReadonlyWhen column is judged per row', () => {
    const fieldDef = { type: 'text', uiReadonlyWhen: "record.status != 'draft'" };
    expect(cellReadOnlyKind({ ...OPEN, fieldDef, row: { status: 'approved' } })).toBe('readonly');
    expect(cellReadOnlyKind({ ...OPEN, fieldDef, row: { status: 'draft' } })).toBeNull();
  });

  it('readonlyWhen TRUE over the row locks the cell too (the same verdict)', () => {
    const fieldDef = { type: 'text', readonlyWhen: "record.status == 'paid'" };
    expect(cellReadOnlyKind({ ...OPEN, fieldDef, row: { status: 'paid' } })).toBe('readonly');
    expect(cellReadOnlyKind({ ...OPEN, fieldDef, row: { status: 'draft' } })).toBeNull();
  });

  it('controls: a plain column edits', () => {
    expect(fieldInlineReadOnlyKind({ type: 'text' })).toBeNull();
    expect(cellReadOnlyKind({ ...OPEN, row: { status: 'approved' } })).toBeNull();
  });
});
