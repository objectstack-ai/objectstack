// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30239 — whether the console offers the Undo on a delete toast.
 * The grant is `allowRestoreOwnDeleted`, read through the spec's own fold
 * (`manageRecycleBin` and `modifyAllRecords` imply it), and the data source
 * must be able to restore at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { canRestoreOwnDeletes, recycleBinRestoreOf, recycleBinRefusalLabelsOf } from '../recycleBinRestore';

describe('canRestoreOwnDeletes (objectstack#30239)', () => {
  it.each([
    ['allowRestoreOwnDeleted', { crm_lead: { allowRead: true, allowRestoreOwnDeleted: true } }, true],
    ['manageRecycleBin implies it', { crm_lead: { allowRead: true, manageRecycleBin: true } }, true],
    ["the '*' row's modifyAllRecords implies it", { '*': { modifyAllRecords: true } }, true],
    ['control: a row without the grant', { crm_lead: { allowRead: true, allowDelete: true } }, false],
    ['control: the grant without read (the fold needs read)', { crm_lead: { allowRestoreOwnDeleted: true } }, false],
    ['control: no row and no wildcard', { crm_account: { allowRead: true, allowRestoreOwnDeleted: true } }, false],
  ])('%s', (_label, map, expected) => {
    expect(canRestoreOwnDeletes(map, 'crm_lead')).toBe(expected);
  });

  it('reads the lowercase key for a name given in another case', () => {
    expect(canRestoreOwnDeletes({ crm_lead: { allowRead: true, allowRestoreOwnDeleted: true } }, 'CRM_Lead')).toBe(true);
  });

  it('control: permissions not loaded is no', () => {
    expect(canRestoreOwnDeletes(undefined, 'crm_lead')).toBe(false);
  });
});

describe('recycleBinRestoreOf (objectstack#30239)', () => {
  const granted = { crm_lead: { allowRead: true, allowRestoreOwnDeleted: true } };

  it('binds the data source restore to the object', async () => {
    const dataSource = { restoreRecycleBinEntry: vi.fn().mockResolvedValue({ restored: 1 }) };
    const restore = recycleBinRestoreOf(dataSource, 'crm_lead', granted);
    await restore!('rb_1');
    expect(dataSource.restoreRecycleBinEntry).toHaveBeenCalledWith('crm_lead', 'rb_1');
  });

  it('control: a data source with no recycle bin offers no restore', () => {
    expect(recycleBinRestoreOf({}, 'crm_lead', granted)).toBeUndefined();
  });

  it('control: a caller without the grant gets no restore', () => {
    const dataSource = { restoreRecycleBinEntry: vi.fn() };
    expect(recycleBinRestoreOf(dataSource, 'crm_lead', { crm_lead: {} })).toBeUndefined();
  });
});

describe('recycleBinRefusalLabelsOf (objectstack#30239)', () => {
  it('names a field of the deleted object by its label, and nothing else', () => {
    const labels = recycleBinRefusalLabelsOf('crm_lead', { fields: { email: { label: 'Email' } } });
    expect(labels.fieldLabel!('crm_lead', 'email')).toBe('Email');
    expect(labels.fieldLabel!('crm_lead', 'phone')).toBeUndefined();
    expect(labels.fieldLabel!('crm_account', 'email')).toBeUndefined();
  });
});
