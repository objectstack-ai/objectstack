// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#3565 — the query string 打开完整表单 opens the New form with: one
 * `<field>=<value>` pair per card field, the contract `RecordFormPage`'s
 * create prefill already reads.
 */
import { describe, expect, it } from 'vitest';
import { recordFormPrefillQuery } from '../recordFormPrefill';

describe('recordFormPrefillQuery', () => {
  it('flattens scalars, joins lists, keeps a lookup id, and leaves empty values out', () => {
    const query = recordFormPrefillQuery([
      { name: 'name', value: '张伟' },
      { name: 'estimated_amount', value: 120000 },
      { name: 'is_vip', value: true },
      { name: 'tags', value: ['打印机', '网络'] },
      { name: 'account', value: 'acc_mouxie' },
      { name: 'note', value: '' },
      { name: 'phone', value: null },
    ]);
    const params = new URLSearchParams(query);
    expect(Object.fromEntries(params.entries())).toEqual({
      name: '张伟',
      estimated_amount: '120000',
      is_vip: 'true',
      tags: '打印机,网络',
      account: 'acc_mouxie',
    });
  });

  it('is empty when nothing survives', () => {
    expect(recordFormPrefillQuery([{ name: 'x', value: undefined }])).toBe('');
    expect(recordFormPrefillQuery([])).toBe('');
  });
});
