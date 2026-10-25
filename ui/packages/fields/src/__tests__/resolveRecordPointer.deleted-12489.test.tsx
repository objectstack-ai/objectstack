/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `referenceDeletedWhen`: a deletion the platform asserts, read by the one
 * pointer rule (objectui#12489).
 *
 * `@objectstack/spec`'s `FieldSchema.referenceDeletedWhen` names a sibling
 * `select` field and one of its options; a row holding that option says the
 * record the pointer names was deleted by the platform. `resolveRecordPointer`
 * evaluates it and hands the pair back with the option's own label, taken from
 * the options the call site supplies. The declaration below is the one
 * objectstack's `plugin-approvals` makes on `sys_approval_request.record_id`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { getCellRenderer, resolveRecordPointer, RECORD_POINTER_CARD_TYPE } from '../index';

afterEach(() => cleanup());

const RECORD_ID = {
  name: 'record_id',
  type: 'text',
  referenceVia: 'object_name',
  referenceDeletedWhen: { field: 'cancel_reason', value: 'record_deleted' },
} as const;

const CANCEL_REASON_OPTIONS = [
  { value: 'record_deleted', label: 'Related record deleted' },
  { value: 'withdrawn', label: 'Withdrawn' },
];
const optionsOf = (name: string) => (name === 'cancel_reason' ? CANCEL_REASON_OPTIONS : undefined);

const DELETED_ROW = { record_id: 'inv_1', object_name: 'invoice', status: 'cancelled', cancel_reason: 'record_deleted' };

describe('resolveRecordPointer reads referenceDeletedWhen (objectui#12489)', () => {
  it('a row holding the declared option comes back with that option label', () => {
    expect(resolveRecordPointer(RECORD_ID, DELETED_ROW, optionsOf)).toEqual({
      objectName: 'invoice',
      recordId: 'inv_1',
      deletedLabel: 'Related record deleted',
    });
  });

  it('the label is the one the call site supplies, so a localized option label is the tombstone', () => {
    const localized = () => [{ value: 'record_deleted', label: '关联记录已删除' }];
    expect(resolveRecordPointer(RECORD_ID, DELETED_ROW, localized)?.deletedLabel).toBe('关联记录已删除');
  });

  it.each([
    ['another option of the sibling', { ...DELETED_ROW, cancel_reason: 'withdrawn' }],
    ['no value on the sibling', { record_id: 'inv_1', object_name: 'invoice', status: 'pending' }],
    ['a null sibling', { ...DELETED_ROW, cancel_reason: null }],
  ])('%s: the pair as before, with no deletedLabel', (_case, row) => {
    expect(resolveRecordPointer(RECORD_ID, row, optionsOf)).toEqual({ objectName: 'invoice', recordId: 'inv_1' });
  });

  it('a field with no referenceDeletedWhen: the pair as before, whatever the row holds', () => {
    const { referenceDeletedWhen: _omit, ...plain } = RECORD_ID;
    expect(resolveRecordPointer(plain, DELETED_ROW, optionsOf)).toEqual({ objectName: 'invoice', recordId: 'inv_1' });
  });

  it('no options supplied: no label to draw, so no deletedLabel', () => {
    expect(resolveRecordPointer(RECORD_ID, DELETED_ROW)).toEqual({ objectName: 'invoice', recordId: 'inv_1' });
  });

  it('⛔ never the raw option value: an option list without that value yields no deletedLabel', () => {
    const others = () => [{ value: 'withdrawn', label: 'Withdrawn' }];
    const pointer = resolveRecordPointer(RECORD_ID, DELETED_ROW, others);
    expect(pointer).toEqual({ objectName: 'invoice', recordId: 'inv_1' });
  });

  it('a half-addressed row stays null even when the predicate holds', () => {
    expect(resolveRecordPointer(RECORD_ID, { ...DELETED_ROW, object_name: '' }, optionsOf)).toBeNull();
  });
});

describe('the default face draws the tombstone label in place of the id (objectui#12489)', () => {
  it('draws deletedLabel, not the record id', () => {
    const Renderer = getCellRenderer(RECORD_POINTER_CARD_TYPE);
    const { container } = render(
      <Renderer
        value={{ objectName: 'invoice', recordId: 'inv_1', deletedLabel: 'Related record deleted' }}
        field={{ name: 'record_id', type: 'text' } as never}
      />,
    );
    expect(container.textContent).toBe('Related record deleted');
  });

  it('CONTROL: a pair with no deletedLabel still draws the record id', () => {
    const Renderer = getCellRenderer(RECORD_POINTER_CARD_TYPE);
    const { container } = render(
      <Renderer value={{ objectName: 'invoice', recordId: 'inv_1' }} field={{ name: 'record_id', type: 'text' } as never} />,
    );
    expect(container.textContent).toBe('inv_1');
  });
});
