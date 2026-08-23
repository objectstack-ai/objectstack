// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10235] The measured oracle, pinned against the SHIPPED corpus: the two
 * `crm_opportunity.expected_revenue` refusal cells (#9313/#10234's harness —
 * the only column-sort PUTs over this app's displayed columns that answer
 * `422 sort-field-unsortable`) must come out UNSORTABLE in the served
 * sortability projection, so the downstream grid (objectui leg) can make the
 * click unofferable.
 *
 * Pinned here — in the app that ships the cells — rather than against an
 * inlined copy, so the oracle cannot drift from the corpus: if the view stops
 * displaying the formula column, or the field stops being a formula, the
 * premise assertions below go red rather than the pin going vacuously green.
 */

import { describe, it, expect } from 'vitest';
import stack from '../objectstack.config.js';
import { resolveObjectSortability } from '@objectstack/spec/api';

const readColumns = (view: any): string[] =>
  (view?.columns ?? []).map((c: any) => (typeof c === 'string' ? c : c?.field)).filter(Boolean);

describe('#10235 sortability oracle — crm_opportunity.expected_revenue', () => {
  const opportunity = (stack.objects ?? []).find((o: any) => o.name === 'crm_opportunity');
  const aggregate: any = (stack.views ?? []).find(
    (v: any) => (v as any)?.list?.data?.object === 'crm_opportunity',
  );

  it('premise: the formula column is DISPLAYED in both measured views', () => {
    // The two refusal cells from the #9313/#10234 measurement: the aggregate's
    // default list and its named `all` list view both ship the column.
    expect(aggregate).toBeDefined();
    expect(readColumns(aggregate.list)).toContain('expected_revenue');
    expect(readColumns(aggregate.listViews?.all)).toContain('expected_revenue');
    // And it IS a formula field on the shipped object — the category the
    // runtime doors refuse (#6994/#7095).
    expect((opportunity as any)?.fields?.expected_revenue?.type).toBe('formula');
  });

  it('the served projection marks the cell unsortable', () => {
    const { fields } = resolveObjectSortability(opportunity);
    expect(fields.expected_revenue).toEqual({ sortable: false, reason: 'virtual-type' });
  });

  it('anti-vacuity: the ordinary persisted columns beside it stay sortable', () => {
    const { fields } = resolveObjectSortability(opportunity);
    expect(fields.amount).toEqual({ sortable: true });
    expect(fields.close_date).toEqual({ sortable: true });
    expect(fields.name).toEqual({ sortable: true });
  });
});
