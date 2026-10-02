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
import { computeViewReferenceDiagnostics, computeMetadataDiagnostics } from '@objectstack/metadata-protocol';

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

  it('flags user-filter tab preset rules pointing at unknown fields', () => {
    const result = computeViewReferenceDiagnostics({
      userFilters: { element: 'tabs', tabs: [{ name: 'bad', filter: [{ field: 'ghost', operator: 'equals', value: 1 }] }] },
    }, objectDef);
    expect(result.valid).toBe(false);
    expect(result.errors?.[0].path).toBe('userFilters.tabs.0.filter.0.field');
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

/**
 * #3095 — `computeMetadataDiagnostics('view', …)` must see through the two
 * runtime `view` shapes the old container schema strip-parsed to `{}` (a
 * standalone ViewItem record and a personalization overlay). Before the fix it
 * returned `{ valid: true }` unconditionally for both, so Studio's badge never
 * flagged a broken enumerated ViewItem. These pin the schema-backed diagnostics.
 */
describe('computeMetadataDiagnostics — view shapes (#3095)', () => {
  it('flags a ViewItem whose kanban config is missing groupByField', () => {
    const diag = computeMetadataDiagnostics('view', {
      name: 'crm_lead.pipeline',
      object: 'crm_lead',
      viewKind: 'list',
      config: { type: 'kanban', columns: ['name'], kanban: { summarizeField: 'amount', columns: ['name'] } },
    });
    expect(diag?.valid).toBe(false);
    expect(diag?.errors?.length).toBeGreaterThan(0);
  });

  it('passes a well-formed ViewItem', () => {
    const diag = computeMetadataDiagnostics('view', {
      name: 'crm_lead.all',
      object: 'crm_lead',
      viewKind: 'list',
      config: { type: 'grid', columns: ['name'], data: { provider: 'object', object: 'crm_lead' } },
    });
    expect(diag?.valid).toBe(true);
  });

  it('passes a personalization overlay body (badges do not regress)', () => {
    const diag = computeMetadataDiagnostics('view', {
      type: 'grid',
      data: { provider: 'object', object: 'showcase_task' },
      columns: ['title'],
      sort: [{ id: 'x', field: 'estimate_hours', order: 'desc' }],
      name: 'showcase_task.default',
      viewKind: 'list',
      object: 'showcase_task',
      label: 'All Tasks',
    });
    expect(diag?.valid).toBe(true);
  });

  it('still validates the defineView container shape', () => {
    expect(computeMetadataDiagnostics('view', {
      list: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
    })?.valid).toBe(true);
    expect(computeMetadataDiagnostics('view', {
      list: { type: 'grid', data: { provider: 'object', object: 'crm_lead' } }, // no columns
    })?.valid).toBe(false);
  });
});
