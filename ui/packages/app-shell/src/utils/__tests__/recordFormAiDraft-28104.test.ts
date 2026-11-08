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
import {
  readRecordFormAiChanges,
  readRecordFormAiDraft,
  recordFormAiChangesState,
  recordFormAiDraftState,
  recordWriteFormTarget,
} from '../recordFormAiDraft';

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

  it('an update opens the edit page with its proposed values in state, bound to the record (objectstack#28106)', () => {
    const target = recordWriteFormTarget(
      { operation: 'update', objectName: 'crm_lead', recordId: 'lead 1', fields: [{ name: 'phone', value: '1' }] },
      'crm',
    );
    expect(target.to).toBe('/apps/crm/crm_lead/record/lead%201/edit');
    expect(readRecordFormAiChanges(target.state, 'lead 1')).toStrictEqual(new Map([['phone', '1']]));
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

describe('an update card\'s proposed values reach the edit page (objectstack#28106)', () => {
  const UPDATE = {
    operation: 'update' as const,
    objectName: 'crm_lead',
    recordId: 'lead_1',
    fields: [
      { name: 'phone', value: '13800000000' },
      { name: 'estimated_amount', value: 90000 },
      { name: 'note', value: '' },
      { name: 'email', value: null },
    ],
  };

  it('nothing rides in the URL; every named field rides in state, an empty (clearing) value included', () => {
    const target = recordWriteFormTarget(UPDATE, 'crm');
    expect(target.to).toBe('/apps/crm/crm_lead/record/lead_1/edit');
    expect(target.to).not.toContain('?');
    expect(target.to).not.toContain('13800000000');
    expect(readRecordFormAiChanges(target.state, 'lead_1')).toStrictEqual(
      new Map<string, unknown>([
        ['phone', '13800000000'],
        ['estimated_amount', 90000],
        ['note', ''],
        ['email', null],
      ]),
    );
  });

  it('only that record\'s edit page reads it, and a create page never does', () => {
    const state = recordWriteFormTarget(UPDATE, 'crm').state;
    expect(readRecordFormAiChanges(state, 'lead_2')).toBeUndefined();
    expect(readRecordFormAiChanges(state, undefined)).toBeUndefined();
    expect(readRecordFormAiDraft(state)).toBeUndefined();
  });

  it('CONTROL: a create\'s draft, or a state that is not a draft, carries no changes', () => {
    expect(readRecordFormAiChanges(recordWriteFormTarget(CREATE, 'crm').state, 'lead_1')).toBeUndefined();
    for (const state of [undefined, null, 'x', {}, { recordFormAiDraft: { values: { a: 1 } } }]) {
      expect(readRecordFormAiChanges(state, 'lead_1')).toBeUndefined();
    }
    expect(recordFormAiChangesState('lead_1', [])).toBeUndefined();
    expect(recordWriteFormTarget({ ...UPDATE, fields: [] }, 'crm')).toStrictEqual({ to: '/apps/crm/crm_lead/record/lead_1/edit' });
  });
});
