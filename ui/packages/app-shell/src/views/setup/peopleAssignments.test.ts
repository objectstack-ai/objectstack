// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { catalogEntries, filterCatalogEntries } from './peopleAssignments.js';

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
