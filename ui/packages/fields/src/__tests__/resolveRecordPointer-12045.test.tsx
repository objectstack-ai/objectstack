/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `referenceVia` pointer pairs: the rule and the default face (objectui#12045).
 *
 * `resolveRecordPointer` is the one place the pair is read, and the default
 * registered under `RECORD_POINTER_CARD_TYPE` is what a host with no richer
 * face draws. The pairs below are two the spec declares on objectstack's
 * system objects: `sys_approval_request.record_id` (sibling `object_name`) and
 * `sys_activity.source_id` (sibling `source_object`), so the rule is pinned on
 * a sibling name other than `object_name` too.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  getCellRenderer,
  resolveRecordPointer,
  RECORD_POINTER_CARD_TYPE,
  TextCellRenderer,
} from '../index';

afterEach(() => cleanup());

const RECORD_ID = { name: 'record_id', type: 'text', referenceVia: 'object_name' } as const;
const SOURCE_ID = { name: 'source_id', type: 'text', referenceVia: 'source_object' } as const;

describe('resolveRecordPointer (objectui#12045)', () => {
  it('reads the approval request pair: the id from the field, the object from its sibling', () => {
    expect(resolveRecordPointer(RECORD_ID, { record_id: 'inv_1', object_name: 'invoice' })).toEqual({
      objectName: 'invoice',
      recordId: 'inv_1',
    });
  });

  it('reads the sibling the field names, not a column called object_name', () => {
    const row = { source_id: 'em_7', source_object: 'sys_email', object_name: 'contact', record_id: 'c_1' };
    expect(resolveRecordPointer(SOURCE_ID, row)).toEqual({ objectName: 'sys_email', recordId: 'em_7' });
  });

  it.each([
    ['a field with no referenceVia', { name: 'record_id', type: 'text' }],
    ['an empty referenceVia', { name: 'record_id', type: 'text', referenceVia: '' }],
    ['a non-text field (the spec refuses referenceVia there)', { name: 'record_id', type: 'lookup', referenceVia: 'object_name' }],
  ])('is null for %s', (_case, field) => {
    expect(resolveRecordPointer(field, { record_id: 'inv_1', object_name: 'invoice' })).toBeNull();
  });

  it.each([
    ['no row', null],
    ['a blank id half', { record_id: '  ', object_name: 'invoice' }],
    ['a missing object half', { record_id: 'inv_1' }],
    ['a blank object half', { record_id: 'inv_1', object_name: '' }],
    ['a non-string id half', { record_id: 42, object_name: 'invoice' }],
  ])('is null for %s', (_case, row) => {
    expect(resolveRecordPointer(RECORD_ID, row as Record<string, unknown> | null)).toBeNull();
  });
});

describe('the default face under RECORD_POINTER_CARD_TYPE (objectui#12045)', () => {
  it('is a renderer of its own, not the total text fallback', () => {
    expect(getCellRenderer(RECORD_POINTER_CARD_TYPE)).not.toBe(TextCellRenderer);
  });

  it('draws the record id as text, as the field drew before its pair was read', () => {
    const Renderer = getCellRenderer(RECORD_POINTER_CARD_TYPE);
    const { container } = render(
      <Renderer value={{ objectName: 'invoice', recordId: 'inv_1' }} field={{ name: 'record_id', type: 'text' } as never} />,
    );
    expect(container.textContent).toBe('inv_1');
  });
});
