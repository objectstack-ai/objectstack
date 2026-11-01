// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28568 — which mark a row of a base's lists carries, and the
 * per-type numbers of the directory, from the served customization read only
 * (ADR-0146 D3; no diff, no `basedOn` verdict, D2/D6).
 */

import { describe, it, expect } from 'vitest';
import {
  customizationBaseOfRow,
  customizationCountsByType,
  customizationMarkOf,
  customizationTotal,
  indexCustomizations,
} from './customizationMarks';
import type { PackageCustomizations } from './packageCustomizations-io';

const READ: PackageCustomizations = {
  packageId: 'hotcrm',
  overrides: [
    { type: 'translation', name: 'crm_en' },
    { type: 'email_template', name: 'welcome', member: 'zh-CN' },
    { type: 'object', name: 'crm_account' },
  ],
  extensions: [
    { object: 'crm_account', kind: 'field', name: 'tier__c' },
    { object: 'crm_lead', kind: 'index', fields: ['email'] },
  ],
  switchedOff: [{ type: 'flow', name: 'nightly_sync' }],
  contributions: [],
  counts: { overrides: 3, extensions: 2, switchedOff: 1, contributions: 0 },
};
const index = indexCustomizations('hotcrm', READ)!;

describe('customizationMarkOf (objectstack#28568)', () => {
  it('a served override is "customized", whether served under the base or the pair', () => {
    expect(customizationMarkOf({ type: 'translation', name: 'crm_en', packageId: 'hotcrm' }, index)).toBe('customized');
    expect(customizationMarkOf({ type: 'translation', name: 'crm_en', packageId: 'hotcrm.custom' }, index)).toBe('customized');
  });

  it('an override of a pair-identified type marks its own member only', () => {
    expect(customizationMarkOf({ type: 'email_template', name: 'welcome', member: 'zh-CN', packageId: 'hotcrm' }, index)).toBe('customized');
    expect(customizationMarkOf({ type: 'email_template', name: 'welcome', member: 'en', packageId: 'hotcrm' }, index)).toBeNull();
    expect(customizationMarkOf({ type: 'email_template', name: 'welcome', packageId: 'hotcrm' }, index)).toBeNull();
  });

  it('any other item of the pair is "added"; the base\'s own items and other packages carry nothing', () => {
    expect(customizationMarkOf({ type: 'translation', name: 'crm_fr', packageId: 'hotcrm.custom' }, index)).toBe('added');
    expect(customizationMarkOf({ type: 'translation', name: 'crm_de', packageId: 'hotcrm' }, index)).toBeNull();
    // The type is part of the identity: a same-named item of another type is not the override.
    expect(customizationMarkOf({ type: 'view', name: 'crm_en', packageId: 'hotcrm' }, index)).toBeNull();
    expect(customizationMarkOf({ type: 'translation', name: 'crm_en', packageId: 'com.example.other' }, index)).toBeNull();
    expect(customizationMarkOf({ type: 'translation', name: 'crm_en' }, index)).toBeNull();
  });

  it('a customization package has no pair to index', () => {
    expect(indexCustomizations('hotcrm.custom', { ...READ, packageId: 'hotcrm.custom' })).toBeNull();
  });
});

describe('the directory\'s numbers (objectstack#28568)', () => {
  it('per type: the served overrides, and the extensions (members) on object', () => {
    expect(customizationCountsByType(READ)).toEqual({ translation: 1, email_template: 1, object: 3 });
  });

  it('the total is the served overrides plus the served extensions, the landing\'s "customized"', () => {
    expect(customizationTotal(READ)).toBe(5);
  });

  it('an empty read counts nothing', () => {
    const empty = { ...READ, overrides: [], extensions: [], counts: { overrides: 0, extensions: 0, switchedOff: 1, contributions: 0 } };
    expect(customizationCountsByType(empty)).toEqual({});
    expect(customizationTotal(empty)).toBe(0);
  });
});

describe('customizationBaseOfRow (objectstack#28568)', () => {
  it('names the base of a pair id, and nothing else', () => {
    expect(customizationBaseOfRow('hotcrm.custom')).toBe('hotcrm');
    expect(customizationBaseOfRow('hotcrm')).toBeNull();
    expect(customizationBaseOfRow(undefined)).toBeNull();
  });
});
