// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28020] Two readers of a stored view filter list, and the any-of group
 * element (`{ any: [rule, ...] }`) the list can now hold.
 *
 * - `computeViewReferenceDiagnostics` checks every field a list view's preset
 *   tabs filter by. A group names no field itself, so read as a rule it was
 *   skipped whole and the fields its rules filter by went unchecked.
 * - `graftNormalizedOperators` copies the spec's operator fold back onto an
 *   authored body by STRUCTURE, with no key list, so it reaches the rules
 *   inside a group without knowing the group exists. Pinned so that stays true.
 */

import { describe, expect, it } from 'vitest';
import { ViewMetadataSchema } from '@objectstack/spec/ui';
import { computeViewReferenceDiagnostics } from './metadata-diagnostics.js';
import { graftNormalizedOperators } from './protocol.js';

const objectDef = { fields: { status: { type: 'select' }, completed_at: { type: 'datetime' } } };

describe('computeViewReferenceDiagnostics and an any-of group in a preset tab', () => {
  const view = (rules: unknown[]) => ({
    userFilters: { tabs: [{ name: 'recent', filter: [{ any: rules }] }] },
  });

  it('a group of real fields is valid', () => {
    expect(computeViewReferenceDiagnostics(view([
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'completed_at', operator: 'after', value: '{7_days_ago}' },
    ]), objectDef)).toEqual({ valid: true });
  });

  it('an unknown field inside a group is reported at its own path', () => {
    const result = computeViewReferenceDiagnostics(view([
      { field: 'status', operator: 'equals', value: 'open' },
      { field: 'ghost', operator: 'equals', value: 'x' },
    ]), objectDef);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([{
      path: 'userFilters.tabs.0.filter.0.any.1.field',
      message: 'Field "ghost" does not exist on the source object',
      code: 'reference_not_found',
    }]);
  });
});

describe('graftNormalizedOperators reaches the rules inside a group', () => {
  it('folds an alias operator inside a group and changes nothing else', () => {
    const authored = {
      name: 'task.recent', object: 'task', viewKind: 'list', label: 'Recent', type: 'grid', columns: ['name'],
      filter: [{ any: [{ field: 'amount', operator: 'gt', value: 1 }, { field: 'status', operator: 'equals', value: 'open' }] }],
    };
    const parsed = ViewMetadataSchema.safeParse(authored);
    expect(parsed.success).toBe(true);
    const out = graftNormalizedOperators(authored, parsed.data) as typeof authored;
    expect(out.filter).toEqual([
      { any: [{ field: 'amount', operator: 'greater_than', value: 1 }, { field: 'status', operator: 'equals', value: 'open' }] },
    ]);
    expect(authored.filter[0]!.any[0]!.operator).toBe('gt');
  });
});
