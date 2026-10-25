// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Regression: an objectList column of kind `select` must render a real
 * dropdown from its `options`, not a free-text input. Before this branch
 * existed the approver `Type` column (a select derived from the spec enum)
 * fell through to a plain `<Input>`, so the computed options — including the
 * ADR-0090 D3 filtering that drops the deprecated `role` spelling — were never
 * shown, and Studio offered no guidance at all.
 *
 * Two behaviours are load-bearing:
 *   1. the current option's label surfaces on the trigger, and
 *   2. a STORED value that is no longer in `options` (a deprecated enum member)
 *      still renders — editing a legacy row must not silently blank it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FlowObjectListField } from './FlowObjectListField';
import type { FlowConfigColumn } from './flow-node-config';

afterEach(cleanup);

// Mirrors the approver objectList: a `select` Type column + a text Value.
const COLUMNS: FlowConfigColumn[] = [
  {
    key: 'type',
    label: 'Type',
    kind: 'select',
    options: [
      { value: 'user', label: 'User' },
      { value: 'org_membership_level', label: 'Org Membership Level' },
      { value: 'position', label: 'Position' },
    ],
  },
  { key: 'value', label: 'Value', kind: 'text' },
];

function renderList(rows: Array<Record<string, unknown>>) {
  return render(
    <FlowObjectListField
      label="Approvers"
      columns={COLUMNS}
      value={rows}
      onCommit={vi.fn()}
      addLabel="Add"
      removeLabel="Remove"
      emptyLabel="None"
    />,
  );
}

describe('FlowObjectListField — select column', () => {
  it('renders a select column as a combobox (not free text)', () => {
    renderList([{ type: 'position', value: 'finance' }]);
    // The trigger surfaces the chosen option's LABEL, which a plain <Input>
    // (value = the raw machine name) never would.
    expect(screen.getByText('Position')).toBeInTheDocument();
    expect(screen.queryByText('Role')).not.toBeInTheDocument();
  });

  it('offers only the non-deprecated options — `role` is absent', () => {
    // The options a fresh row can pick from must match COLUMNS.options exactly;
    // `role` was never an option here (it is filtered upstream by
    // xEnumDeprecated), and the component must not reintroduce it.
    expect(COLUMNS[0].options?.map((o) => o.value)).not.toContain('role');
  });

  it('still renders a STORED deprecated value, flagged, so a legacy row is not blanked', () => {
    // `role` is not among the offered options, but a flow authored on 15.x has
    // it stored. It must remain visible (and marked) rather than vanish.
    renderList([{ type: 'role', value: 'admin' }]);
    expect(screen.getByText('role (deprecated)')).toBeInTheDocument();
  });
});
