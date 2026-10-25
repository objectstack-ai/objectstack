/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { enrichDetailField } from '../fieldEnrichment';

describe('enrichDetailField', () => {
  it('carries the relational picker configuration a lookup editor needs', () => {
    const enriched = enrichDetailField(
      { name: 'tags', label: 'Tags' },
      {
        type: 'lookup',
        reference: 'tags',
        multiple: true,
        displayField: 'name',
        idField: 'code',
        lookupFilters: [{ field: 'active', operator: 'eq', value: true }],
        depends_on: ['category'],
        picker: 'search',
      },
    );

    expect(enriched).toMatchObject({
      type: 'lookup',
      // `reference`, the one target spelling (objectui#11070 round 4).
      reference: 'tags',
      multiple: true,
      displayField: 'name',
      idField: 'code',
      picker: 'search',
      depends_on: ['category'],
    });
    expect(enriched.lookupFilters).toEqual([{ field: 'active', operator: 'eq', value: true }]);
  });

  it('keeps the view field as the override — the schema only fills gaps', () => {
    const enriched = enrichDetailField(
      { name: 'amount', type: 'currency', currency: 'EUR' },
      { type: 'number', currency: 'USD', scale: 2, min: 0 },
    );

    expect(enriched.type).toBe('currency');
    expect(enriched.currency).toBe('EUR');
    expect(enriched.scale).toBe(2);
    expect(enriched.min).toBe(0);
  });

  it('never copies `readonly` (the hosts gate editability off the schema directly)', () => {
    const enriched = enrichDetailField({ name: 'code' }, { type: 'text', readonly: true });
    expect(enriched.readonly).toBeUndefined();
  });

  it('is a no-op passthrough when the field has no object metadata', () => {
    expect(enrichDetailField({ name: 'ad_hoc', type: 'text' }, undefined)).toEqual({
      name: 'ad_hoc',
      type: 'text',
    });
  });
});
