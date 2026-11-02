// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { blankAsNullColumns, blankStorageForm, ENGINE_LIFECYCLE_COLUMNS } from './blank-storage-form.js';

const schema = {
  fields: {
    qty: { type: 'number', required: true },
    due: { type: 'date' },
    sku: { type: 'text', unique: true },
    code: { type: 'text' },
    idx_a: { type: 'text' },
    pw: { type: 'password', unique: true },
    stage: { type: 'select', options: [{ value: 'a' }] },
    stage_req: { type: 'select', required: true, options: [{ value: 'a' }] },
    tags: { type: 'select', multiple: true, options: [{ value: 'a' }] },
    ref: { type: 'lookup' },
    pic: { type: 'image' },
    blob: { type: 'json' },
    num: { type: 'autonumber' },
    created_by: { type: 'user' },
    created_at: { type: 'datetime' },
  },
  indexes: [{ fields: ['idx_a'], unique: true }, { fields: ['code'] }],
};

describe('blankAsNullColumns: the four arms of the write door\'s blank-as-null rule', () => {
  const cols = blankAsNullColumns(schema);

  it('[#20308] a typed column takes any blank, required and lifecycle included', () => {
    expect(cols.get('qty')).toBe('blank');
    expect(cols.get('due')).toBe('blank');
    expect(cols.get('created_at')).toBe('blank');
  });

  it('[#29176] exactly "" on an optional text column a unique constraint covers', () => {
    expect(cols.get('sku')).toBe('empty');
    expect(cols.get('idx_a')).toBe('empty');
    expect(cols.has('code')).toBe(false);
    expect(cols.has('pw')).toBe(false);
  });

  it('[#29277] exactly "" on an optional one-string null_only column, unique or not', () => {
    expect(cols.get('stage')).toBe('empty');
    expect(cols.get('ref')).toBe('empty');
    expect(cols.get('pic')).toBe('empty');
    for (const out of ['stage_req', 'tags', 'blob', 'num', 'created_by']) expect(cols.get(out), out).not.toBe('empty');
  });

  it('[#29343] "emptyList" on every optional column on the multi_value row, unique or not', () => {
    const list = blankAsNullColumns({
      fields: {
        tags: { type: 'select', multiple: true, options: [{ value: 'a' }] },
        ms: { type: 'multiselect', options: [{ value: 'a' }] },
        ms_u: { type: 'multiselect', unique: true, options: [{ value: 'a' }] },
        cb: { type: 'checkboxes', options: [{ value: 'a' }] },
        tg: { type: 'tags' },
        refs: { type: 'lookup', multiple: true },
        pics: { type: 'image', multiple: true },
        ms_req: { type: 'multiselect', required: true, options: [{ value: 'a' }] },
        created_by: { type: 'user', multiple: true },
        ref: { type: 'lookup' },
      },
    });
    for (const f of ['tags', 'ms', 'ms_u', 'cb', 'tg', 'refs', 'pics']) expect(list.get(f), f).toBe('emptyList');
    expect(list.has('ms_req')).toBe(false);
    expect(list.has('created_by')).toBe(false);
    expect(list.get('ref')).toBe('empty');
  });

  it('lifecycle names are the five engine-owned columns', () => {
    expect([...ENGINE_LIFECYCLE_COLUMNS]).toEqual(['id', 'created_at', 'created_by', 'updated_at', 'updated_by']);
  });

  it('an unresolvable definition declares none', () => {
    expect(blankAsNullColumns(undefined).size).toBe(0);
    expect(blankAsNullColumns({}).size).toBe(0);
  });
});

describe('blankStorageForm', () => {
  it('"blank" nulls "" and whitespace; "empty" nulls only ""; no reach keeps everything', () => {
    expect(blankStorageForm('', 'blank')).toBeNull();
    expect(blankStorageForm('  ', 'blank')).toBeNull();
    expect(blankStorageForm('', 'empty')).toBeNull();
    expect(blankStorageForm('  ', 'empty')).toBe('  ');
    expect(blankStorageForm('', undefined)).toBe('');
  });

  it('"emptyList" nulls [] and exactly ""; whitespace and a non-empty list stay', () => {
    expect(blankStorageForm([], 'emptyList')).toBeNull();
    expect(blankStorageForm('', 'emptyList')).toBeNull();
    const list = ['a'];
    expect(blankStorageForm(list, 'emptyList')).toBe(list);
    for (const v of ['  ', 'a', 0, false, null, undefined]) expect(blankStorageForm(v, 'emptyList')).toBe(v);
    // An empty list on any other reach is not a blank of that column.
    const empty: unknown[] = [];
    for (const r of ['blank', 'empty', undefined] as const) expect(blankStorageForm(empty, r)).toBe(empty);
  });

  it('a non-blank value or a non-string comes back as it is', () => {
    const obj = { a: 1 };
    for (const v of ['a', 0, false, null, undefined, obj]) {
      expect(blankStorageForm(v, 'blank')).toBe(v);
      expect(blankStorageForm(v, 'empty')).toBe(v);
    }
  });
});
