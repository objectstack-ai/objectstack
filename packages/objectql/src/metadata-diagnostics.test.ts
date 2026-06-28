// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0047 — reference-integrity diagnostics for list views.
 *
 * `computeViewReferenceDiagnostics` covers what the per-type Zod schema
 * cannot: every field referenced by the user-facing filter surface must
 * exist on the source object, and binding-dependent visualizations must
 * have resolvable bindings.
 */

import { describe, expect, it } from 'vitest';
import { computeViewReferenceDiagnostics } from '@objectstack/metadata-protocol';

const objectDef = {
  fields: {
    name: { type: 'text' },
    industry: { type: 'select' },
    status: { type: 'select' },
    is_active: { type: 'boolean' },
    due_date: { type: 'date' },
  },
};

describe('computeViewReferenceDiagnostics (ADR-0047)', () => {
  it('passes when every reference resolves', () => {
    const result = computeViewReferenceDiagnostics({
      userFilters: {
        element: 'dropdown',
        fields: [{ field: 'industry' }, { field: 'is_active' }],
        tabs: [{ name: 't', filter: [{ field: 'status', operator: 'equals', value: 'x' }] }],
      },
      tabs: [{ name: 'a', filter: [{ field: 'industry', operator: 'equals', value: 'technology' }] }],
      filterableFields: ['status'],
      kanban: { groupByField: 'status', columns: ['name'] },
    }, objectDef);
    expect(result.valid).toBe(true);
  });

  it('flags userFilters fields missing on the object', () => {
    const result = computeViewReferenceDiagnostics({
      userFilters: { element: 'dropdown', fields: [{ field: 'no_such_field' }] },
    }, objectDef);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatchObject({
      path: 'userFilters.fields.0.field',
      code: 'reference_not_found',
    });
  });

  it('flags tab filter rules pointing at unknown fields', () => {
    const result = computeViewReferenceDiagnostics({
      tabs: [{ name: 'bad', filter: [{ field: 'ghost', operator: 'equals', value: 1 }] }],
    }, objectDef);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0].path).toBe('tabs.0.filter.0.field');
  });

  it('flags kanban groupBy on a non-select-like field', () => {
    const result = computeViewReferenceDiagnostics({
      kanban: { groupByField: 'due_date', columns: ['name'] },
    }, objectDef);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatchObject({
      path: 'kanban.groupByField',
      code: 'invalid_binding',
    });
  });

  it('supports array-shaped field definitions', () => {
    const result = computeViewReferenceDiagnostics({
      filterableFields: ['priority', 'missing'],
    }, { fields: [{ name: 'priority', type: 'select' }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0].path).toBe('filterableFields.1');
  });

  it('is permissive when the view has no filter surface', () => {
    expect(computeViewReferenceDiagnostics({}, objectDef).valid).toBe(true);
    expect(computeViewReferenceDiagnostics({}, {}).valid).toBe(true);
  });
});
