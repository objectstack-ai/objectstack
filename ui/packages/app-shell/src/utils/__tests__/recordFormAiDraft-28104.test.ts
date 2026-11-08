/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28104 — "Open the full form" on a record-write card carries the
 * card's values in router state, never in the query string, and the New page
 * reads back exactly what was sent.
 */
import { describe, expect, it } from 'vitest';
import { readRecordFormAiDraft, recordFormAiDraftState, recordWriteFormTarget } from '../recordFormAiDraft';

const CREATE = {
  operation: 'create' as const,
  objectName: 'crm_lead',
  fields: [
    { name: 'name', value: '张伟' },
    { name: 'phone', value: '13900001111' },
    { name: 'estimated_amount', value: 120000 },
    { name: 'is_vip', value: false },
    { name: 'tags', value: ['打印机', '网络'] },
    { name: 'note', value: '' },
    { name: 'email', value: null },
    { name: 'labels', value: [] },
  ],
};

describe('recordWriteFormTarget (objectstack#28104)', () => {
  it('a create opens /new with no query string and the values in state, types kept', () => {
    const target = recordWriteFormTarget(CREATE, 'crm');
    expect(target.to).toBe('/apps/crm/crm_lead/new');
    expect(target.to).not.toContain('?');
    expect(target.to).not.toContain('13900001111');
    expect(readRecordFormAiDraft(target.state)).toStrictEqual({
      name: '张伟',
      phone: '13900001111',
      estimated_amount: 120000,
      is_vip: false,
      tags: ['打印机', '网络'],
    });
  });

  it('a create whose fields are all empty opens a plain /new with no state', () => {
    const target = recordWriteFormTarget({ ...CREATE, fields: [{ name: 'note', value: '' }] }, 'crm');
    expect(target).toStrictEqual({ to: '/apps/crm/crm_lead/new' });
  });

  it('an update opens the edit page on the stored record and carries no draft', () => {
    const target = recordWriteFormTarget(
      { operation: 'update', objectName: 'crm_lead', recordId: 'lead 1', fields: [{ name: 'phone', value: '1' }] },
      'crm',
    );
    expect(target).toStrictEqual({ to: '/apps/crm/crm_lead/record/lead%201/edit' });
  });
});

describe('readRecordFormAiDraft (objectstack#28104)', () => {
  it('reads nothing from a state that is not a draft', () => {
    for (const state of [undefined, null, 'x', 1, {}, { from: { pathname: '/a' } }, { recordFormAiDraft: 'x' },
      { recordFormAiDraft: { values: ['a'] } }, { recordFormAiDraft: { values: { a: '' } } }]) {
      expect(readRecordFormAiDraft(state)).toBeUndefined();
    }
  });

  it('round-trips the state recordFormAiDraftState builds', () => {
    expect(readRecordFormAiDraft(recordFormAiDraftState([{ name: 'a', value: 1 }]))).toStrictEqual({ a: 1 });
    expect(recordFormAiDraftState([])).toBeUndefined();
  });
});
