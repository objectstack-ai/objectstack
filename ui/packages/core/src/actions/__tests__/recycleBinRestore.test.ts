/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#30239 (ADR-0148 D2) — every code the restore door answers reads
 * as its own sentence. The translator echoes the key and its variables, so
 * each case pins WHICH key a code reaches and what it names; the packs'
 * wording is pinned in `@object-ui/i18n` (`recycle-bin-refusals-30239`).
 */

import { describe, it, expect } from 'vitest';
import { RECYCLE_BIN_RESTORE_REFUSAL_CODES } from '@objectstack/spec/data';
import { recycleBinRestoreRefusalText, RECYCLE_BIN_RESTORE_REFUSAL_KEYS } from '../recycleBinRestore';

const t = (key: string, options?: Record<string, unknown>) => `${key} ${JSON.stringify(options ?? {})}`;
const labels = {
  objectLabel: (name: string) => ({ crm_lead: 'Lead', crm_account: 'Account' } as Record<string, string>)[name],
  fieldLabel: (object: string, field: string) => (object === 'crm_lead' && field === 'email' ? 'Email' : undefined),
};
const refusal = (code: string, details?: Record<string, unknown>) =>
  Object.assign(new Error('server text'), { code, ...(details ? { details } : {}) });

describe('recycleBinRestoreRefusalText (objectstack#30239)', () => {
  it('covers every restore refusal code the spec names, plus the door\'s 404, 403 and 501', () => {
    for (const code of Object.values(RECYCLE_BIN_RESTORE_REFUSAL_CODES)) {
      expect(RECYCLE_BIN_RESTORE_REFUSAL_KEYS[code], code).toBeDefined();
    }
    expect(Object.keys(RECYCLE_BIN_RESTORE_REFUSAL_KEYS).sort()).toEqual([
      'NOT_IMPLEMENTED',
      'PERMISSION_DENIED',
      'RECORD_NOT_FOUND',
      'RESTORE_PACKAGE_UNINSTALLED',
      'RESTORE_PARENT_IN_RECYCLE_BIN',
      'RESTORE_PARENT_PURGED',
      'RESTORE_UNIQUE_VALUE_TAKEN',
    ]);
    // Seven codes, seven distinct sentences.
    expect(new Set(Object.values(RECYCLE_BIN_RESTORE_REFUSAL_KEYS)).size).toBe(7);
  });

  it.each([
    ['RESTORE_UNIQUE_VALUE_TAKEN', { object: 'crm_lead', recordId: 'l1', field: 'email' },
      'recycleBin.refusal.uniqueValueTaken {"object":"Lead","parent":"","field":"Email"}'],
    ['RESTORE_PARENT_PURGED', { object: 'crm_lead', parentObject: 'crm_account', parentId: 'a1' },
      'recycleBin.refusal.parentPurged {"object":"Lead","parent":"Account","field":""}'],
    ['RESTORE_PACKAGE_UNINSTALLED', { object: 'pkg_gone' },
      'recycleBin.refusal.packageUninstalled {"object":"pkg_gone","parent":"","field":""}'],
    ['RESTORE_PARENT_IN_RECYCLE_BIN', { object: 'crm_lead', parentObject: 'crm_account', parentEntryId: 'rb0' },
      'recycleBin.refusal.parentInRecycleBin {"object":"Lead","parent":"Account","field":""}'],
    ['RECORD_NOT_FOUND', { object: 'crm_lead', entryId: 'rb9' },
      'recycleBin.refusal.notFound {"object":"Lead","parent":"","field":""}'],
    ['PERMISSION_DENIED', undefined, 'recycleBin.refusal.permissionDenied {"object":"","parent":"","field":""}'],
    ['NOT_IMPLEMENTED', undefined, 'recycleBin.refusal.notAvailable {"object":"","parent":"","field":""}'],
  ])('%s reads as its own sentence, naming the rows it refers to', (code, details, expected) => {
    const sentence = recycleBinRestoreRefusalText(t, refusal(code, details), labels);
    expect(sentence).toBe(expected);
    expect(sentence).not.toContain('server text');
  });

  it('a field of another object, or with no label, reads by its machine name', () => {
    expect(recycleBinRestoreRefusalText(t, refusal('RESTORE_UNIQUE_VALUE_TAKEN', { object: 'crm_contact', field: 'email' }), labels))
      .toBe('recycleBin.refusal.uniqueValueTaken {"object":"crm_contact","parent":"","field":"email"}');
  });

  it('control: a code it does not know, no code, or no error answers undefined (the caller keeps its generic copy)', () => {
    expect(recycleBinRestoreRefusalText(t, refusal('VALIDATION_FAILED'), labels)).toBeUndefined();
    expect(recycleBinRestoreRefusalText(t, new Error('boom'), labels)).toBeUndefined();
    expect(recycleBinRestoreRefusalText(t, undefined, labels)).toBeUndefined();
  });
});
