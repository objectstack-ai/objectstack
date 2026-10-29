// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27461 — the roll-up's "Child field to aggregate" picker offers
 * only the child fields the spec accepts for the chosen function.
 *
 * The card: with Aggregation = Sum, the picker listed text fields, the audit
 * columns, the owner lookup and the master-detail parent beside the one
 * number. The spec already says which field types each aggregate accepts
 * (`isAggregateCompatibleWithFieldType`, the table both the dataset compiler
 * and the engine's aggregate door read), so the picker reads that rule: every
 * expectation below is paired with the rule's own verdict on the same child
 * fields, so the picker can be neither wider nor narrower than the spec.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { isAggregateCompatibleWithFieldType } from '@objectstack/spec/data';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

/** The card's child object: a number beside text, audit, relationship, a rate, a flag and a formula. */
const CHILD_FIELDS = [
  { name: 'name', label: 'Name', type: 'text', hidden: false },
  { name: 'memo', label: 'Memo', type: 'textarea', hidden: false },
  { name: 'created_at', label: 'Created At', type: 'datetime', hidden: false },
  { name: 'owner', label: 'Owner', type: 'lookup', hidden: false },
  { name: 'parent', label: 'Parent', type: 'master_detail', hidden: false },
  { name: 'amount', label: 'Amount', type: 'number', hidden: false },
  { name: 'rate', label: 'Rate', type: 'percent', hidden: false },
  { name: 'done', label: 'Done', type: 'boolean', hidden: false },
  { name: 'margin', label: 'Margin', type: 'formula', hidden: false },
];

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (obj?: string) => ({ fields: obj ? CHILD_FIELDS : [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

function renderRollup(summaryOperations: Record<string, unknown>) {
  render(
    <ObjectFieldInspector
      type="object"
      name="parent_obj"
      draft={{ name: 'parent_obj', fields: { total: { type: 'summary', label: 'Total', summaryOperations } } }}
      selection={{ kind: 'field', id: 'total' }}
      onPatch={vi.fn()}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={'en-US'}
    />,
  );
}

/** The API names the "Child field to aggregate" picker offers, opened. */
async function offeredAggregands(): Promise<string[]> {
  fireEvent.click(screen.getByLabelText('Child field to aggregate'));
  const list = await screen.findByRole('listbox');
  return within(list).getAllByRole('option').map((o) => o.getAttribute('data-value') ?? '');
}

/** The child fields the spec's rule accepts for `fn`. */
const specAccepts = (fn: string) =>
  CHILD_FIELDS.filter((f) => isAggregateCompatibleWithFieldType(fn, f.type)).map((f) => f.name);

describe('roll-up child-field picker follows the spec\'s aggregate × field-type rule (objectstack#27461)', () => {
  it('Sum: the card\'s text, audit and relationship fields are gone; the number is offered', async () => {
    renderRollup({ object: 'child_obj', function: 'sum' });
    const offered = await offeredAggregands();
    expect(offered).toEqual(specAccepts('sum'));
    expect(offered).toContain('amount');
    for (const refused of ['name', 'memo', 'created_at', 'owner', 'parent', 'margin']) {
      expect(offered).not.toContain(refused);
    }
  });

  it('each value-reading function offers exactly what the rule accepts for it', async () => {
    for (const fn of ['sum', 'avg', 'min', 'max']) {
      renderRollup({ object: 'child_obj', function: fn });
      expect(await offeredAggregands(), fn).toEqual(specAccepts(fn));
      cleanup();
    }
    // The rule is what differs, not the picker: a rate averages but does not
    // add, and a date has an earliest but no total.
    expect(specAccepts('avg')).toContain('rate');
    expect(specAccepts('sum')).not.toContain('rate');
    expect(specAccepts('min')).toContain('created_at');
  });

  it('before a function is picked: a field some value-reading function accepts', async () => {
    renderRollup({ object: 'child_obj' });
    const union = CHILD_FIELDS.filter((f) =>
      ['sum', 'avg', 'min', 'max'].some((fn) => isAggregateCompatibleWithFieldType(fn, f.type)),
    ).map((f) => f.name);
    expect(await offeredAggregands()).toEqual(union);
  });
});
