// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8990 — the CRM example's row action survives the SPARSE action face.
 *
 * `crm_convert_lead` reaches `list_item`, so its `visible` predicate binds a
 * LIST ROW carrying only the view's `$select` projection — not a total record.
 * Unguarded, `record.status != "converted"` aborts at key resolution on any
 * lead list that does not project `status`, and CEL's fault is fail-closed: the
 * Convert Lead button silently is not offered, which looks exactly like the
 * predicate having said no.
 *
 * This example is reference material — it is what an author (human or AI)
 * copies when writing their first row action — so the guard being present here
 * is worth a test of its own rather than review. The rule itself lives on
 * `materializeDeclaredFields` in `@objectstack/objectql` (#8975).
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { ConvertLeadAction } from '../src/actions/convert-lead.action.js';

function evaluate(source: string, record: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate({ dialect: 'cel', source }, { record, user: { id: 'u1' } });
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

/**
 * `defineAction` normalizes the CEL shorthand string into a `{dialect, source}`
 * envelope at parse time — read the source through the envelope, or the
 * assertions run against `undefined` and pass for the wrong reason.
 */
const raw: unknown = ConvertLeadAction.visible;
const source =
  typeof raw === 'string'
    ? raw
    : ((raw as { source?: string } | undefined)?.source ?? '');

describe('#8990 — crm_convert_lead visible on a sparse list row', () => {

  it('reaches list_item, so the sparse binding is the real one', () => {
    expect(ConvertLeadAction.locations).toContain('list_item');
  });

  it('is has()-guarded on the column it reads', () => {
    expect(source).toContain('has(record.status)');
  });

  it('answers false instead of faulting when the view did not project status', () => {
    expect(evaluate(source, { id: 'lead_1', name: 'Acme' })).toBe(false);
    // The unguarded spelling is what that binding used to do — pinned so the
    // regression is recognisable rather than re-derived.
    expect(evaluate('record.status != "converted"', { id: 'lead_1', name: 'Acme' }))
      .toBe('FAULT No such key: status');
  });

  it('still hides the button on a converted lead and offers it otherwise', () => {
    expect(evaluate(source, { status: 'converted' })).toBe(false);
    expect(evaluate(source, { status: 'new' })).toBe(true);
    expect(evaluate(source, { status: 'qualified' })).toBe(true);
    // A projected-but-null status is not "converted", so the button is offered
    // — the equality operand never faults on null, which is why `has()` alone
    // is the whole guard here.
    expect(evaluate(source, { status: null })).toBe(true);
  });
});
