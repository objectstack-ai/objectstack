/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * User-filter control arity ↔ spec vocabulary parity + behavior (#2941).
 *
 * `UserFilterFieldSchema.type` (`ui/view.zod.ts`) names both `select` and
 * `multi-select`, so `select` necessarily means single-choice. The dropdown
 * filter used to render accumulating checkboxes for every control type — a
 * single-choice filter silently accepted many values, and the emitted
 * condition looked plausible (`['status', 'in', [a, b]]`) while contradicting
 * the authored contract.
 *
 * Contract under test:
 * - parity: `FILTER_CONTROL_KINDS` maps exactly the spec's vocabulary;
 * - authored `type: 'select'` renders radios and replaces the pick;
 * - authored `type: 'multi-select'` (and an omitted, inferred type) keeps
 *   accumulating checkboxes;
 * - restored/default selections for a single-choice control clamp to one.
 */
import * as React from 'react';
import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserFilterFieldSchema } from '@objectstack/spec/ui';
import { shapeEnumOptions } from '@object-ui/test-support';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields } from '@object-ui/fields';
import { UserFilters, FILTER_CONTROL_KINDS } from '../UserFilters';

const objectDef = {
  name: 'tasks',
  fields: {
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'To Do', value: 'todo' },
        { label: 'Doing', value: 'doing' },
        { label: 'Done', value: 'done' },
      ],
    },
  },
};

describe('FILTER_CONTROL_KINDS covers the spec user-filter control vocabulary', () => {
  const specNames = shapeEnumOptions(UserFilterFieldSchema, 'type');

  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read UserFilterFieldSchema.shape.type options from the spec').not.toEqual([]);
  });

  it('declares an arity for every control type the spec accepts', () => {
    const undeclared = specNames.filter((name) => !(name in FILTER_CONTROL_KINDS));
    expect(
      undeclared,
      'these pass schema validation with no declared control kind — add them to FILTER_CONTROL_KINDS',
    ).toEqual([]);
  });

  it('does not declare control types the spec rejects', () => {
    const extra = Object.keys(FILTER_CONTROL_KINDS).filter((name) => !specNames.includes(name));
    expect(
      extra,
      'these are renderer-local dialect — promote them into @objectstack/spec instead',
    ).toEqual([]);
  });
});

describe("filter type 'select' is single-choice", () => {
  it('renders radios and replaces the pick instead of accumulating', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status', type: 'select' }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-badge-status'));
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(screen.getByText('To Do'));
    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['todo']]]);

    // Picking a second option REPLACES the first — never two values at once.
    fireEvent.click(screen.getByText('Done'));
    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['done']]]);
  });

  it("authored 'multi-select' keeps accumulating checkboxes", () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status', type: 'multi-select' }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-badge-status'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);

    fireEvent.click(screen.getByText('To Do'));
    fireEvent.click(screen.getByText('Done'));
    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['todo', 'done']]]);
  });

  it('an omitted (inferred) type keeps the historical multi-check UX', () => {
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status' }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-badge-status'));
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('clamps a multi-value restored selection to one value', () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'status', type: 'select' }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
        initialSelections={{ status: ['todo', 'done'] }}
      />,
    );

    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['todo']]]);
  });
});

describe("Tier 2 (#2942): 'toggle' element and range/text controls render", () => {
  it("element: 'toggle' renders the filter bar instead of deleting it", () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'toggle', fields: [{ field: 'status', defaultValues: ['todo'] }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    // The whole bar used to vanish (`default: return null`).
    expect(screen.getByTestId('user-filters-toggle')).toBeInTheDocument();
    const btn = screen.getByTestId('filter-toggle-status');
    // Default-active toggle emitted its filter on mount; clicking it off clears.
    expect(onFilterChange).toHaveBeenLastCalledWith([['status', 'in', ['todo']]]);
    fireEvent.click(btn);
    expect(onFilterChange).toHaveBeenLastCalledWith([]);
  });

  it("'date-range' renders a from/to pair and emits >=/<= bounds", () => {
    // The native pair: the fallback with no `field:date` widget registered.
    // `@object-ui/fields` registers the platform picker on import; that face
    // is pinned in `UserFilters.dateRangePicker-12784.test.tsx`.
    ComponentRegistry.unregister('date', 'field');
    onTestFinished(() => registerAllFields());
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'due_date', type: 'date-range' }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-badge-due_date'));
    expect(screen.getByTestId('filter-range-due_date')).toBeInTheDocument();
    expect(screen.queryByText('No options')).not.toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('To')).toHaveAttribute('type', 'date');

    fireEvent.change(screen.getByTestId('filter-range-due_date-from'), { target: { value: '2026-01-01' } });
    expect(onFilterChange).toHaveBeenLastCalledWith([['due_date', '>=', '2026-01-01']]);

    fireEvent.change(screen.getByTestId('filter-range-due_date-to'), { target: { value: '2026-02-01' } });
    expect(onFilterChange).toHaveBeenLastCalledWith([
      ['due_date', '>=', '2026-01-01'],
      ['due_date', '<=', '2026-02-01'],
    ]);
  });

  it("'text' renders a search input and emits a contains query on Enter", () => {
    const onFilterChange = vi.fn();
    render(
      <UserFilters
        config={{ element: 'dropdown', fields: [{ field: 'name', type: 'text' }] } as any}
        objectDef={objectDef}
        data={[]}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByTestId('filter-badge-name'));
    const input = screen.getByTestId('filter-text-name');
    expect(screen.queryByText('No options')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'acme' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onFilterChange).toHaveBeenLastCalledWith([['name', 'contains', 'acme']]);
  });
});
