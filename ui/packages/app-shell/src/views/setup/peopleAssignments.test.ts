// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { catalogEntries, catalogEntryKey, entryAnswersPick, filterCatalogEntries } from './peopleAssignments.js';

describe('catalogEntries', () => {
  it('keeps named items, labels a label-less one by its name, and sorts by label then name', () => {
    const entries = catalogEntries([
      { name: 'zeta', label: 'Auditor' },
      { name: 'alpha' },
      { label: 'no name' },
      null,
      { name: 'beta', label: '  ', description: 'Reads.' },
      { name: 'alpha', label: 'Duplicate' },
    ]);
    expect(entries).toEqual([
      { name: 'alpha', label: 'alpha', description: '' },
      { name: 'zeta', label: 'Auditor', description: '' },
      { name: 'beta', label: 'beta', description: 'Reads.' },
    ]);
  });
});

describe('filterCatalogEntries', () => {
  const entries = catalogEntries([{ name: 'sales_rep', label: 'Sales rep' }, { name: 'auditor', label: 'Auditor' }]);

  it('matches the label or the name, ignoring case and surrounding space', () => {
    expect(filterCatalogEntries(entries, ' SALES ').map((e) => e.name)).toEqual(['sales_rep']);
    expect(filterCatalogEntries(entries, 'audi').map((e) => e.name)).toEqual(['auditor']);
    expect(filterCatalogEntries(entries, 'rep').map((e) => e.name)).toEqual(['sales_rep']);
  });

  it('returns every entry for an empty query', () => {
    expect(filterCatalogEntries(entries, '')).toHaveLength(2);
  });
});

describe('catalogEntries by holder (objectstack#32537)', () => {
  const items = [
    { name: 'sales_rep', label: 'Sales rep', _packageId: 'com.acme.sales' },
    { name: 'auditor', label: 'Auditor', _packageId: 'com.acme.crm' },
    { name: 'sales_rep', label: 'Sales rep', _packageId: 'sys_metadata' },
    { name: 'sales_rep', label: 'Sales rep', _packageId: 'com.acme.crm' },
  ];

  it('lists a name more than one package holds once per holder, the environment first; one holder once, as before', () => {
    // Every holder of the name, in the order served.
    const holders = ['com.acme.sales', null, 'com.acme.crm'];
    expect(catalogEntries(items, { byHolder: true })).toEqual([
      { name: 'auditor', label: 'Auditor', description: '' },
      { name: 'sales_rep', label: 'Sales rep', description: '', holding: { packageId: null, holders } },
      { name: 'sales_rep', label: 'Sales rep', description: '', holding: { packageId: 'com.acme.crm', holders } },
      { name: 'sales_rep', label: 'Sales rep', description: '', holding: { packageId: 'com.acme.sales', holders } },
    ]);
    // CONTROL: without `byHolder` a name is one entry.
    expect(catalogEntries(items).map((e) => e.name)).toEqual(['auditor', 'sales_rep']);
  });

  it("answers a link's pick by the name, and by its package where the entry is one of several holders", () => {
    const [auditor, env, crm] = catalogEntries(items, { byHolder: true });
    expect(entryAnswersPick(auditor, 'auditor', null)).toBe(true);
    expect(entryAnswersPick(auditor, 'auditor', 'com.other')).toBe(true);
    expect(entryAnswersPick(crm, 'sales_rep', 'com.acme.crm')).toBe(true);
    expect(entryAnswersPick(crm, 'sales_rep', null)).toBe(false);
    // The environment's own set is the one the name alone addresses.
    expect(entryAnswersPick(env, 'sales_rep', null)).toBe(true);
    expect(entryAnswersPick(env, 'sales_rep', 'com.acme.crm')).toBe(false);
    expect(catalogEntryKey(crm)).toBe('sales_rep@com.acme.crm');
    expect(catalogEntryKey(auditor)).toBe('auditor');
  });
});
