// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WIDGETS, type WidgetContext } from './widgets';
import { loaded } from './loadState';

afterEach(cleanup);

const FilterMode = WIDGETS['filter-mode'];
// A catalog that LOADED and holds three fields. `loaded(...)` rather than the
// bare array since objectui#5228: the catalog is a `LoadState`, so a fixture has
// to say which arm it is standing in — an empty list and a failed load are no
// longer the same value.
const ctx: WidgetContext = {
  // objectui#8167 made `conditionScope` required. `'flattened'` is what every
  // mount ran under before it existed, so this fixture's subject is unmoved.
  conditionScope: 'flattened',
  objectFields: loaded([
    { name: 'status', label: 'Status' },
    { name: 'priority', label: 'Priority' },
    { name: 'owner', label: 'Owner' },
  ]),
};

/**
 * ADR-0047 filter-mode widget. None is a first-class UI state that maps to
 * ABSENCE of userFilters (onChange(undefined)) — the protocol stores "no
 * filter bar" as omission, not a literal element: 'none'.
 */
describe('filter-mode widget', () => {
  it('shows None active when value is absent', () => {
    render(<FilterMode value={undefined} onChange={() => {}} context={ctx} schema={{}} />);
    expect(screen.getByTestId('filter-mode-none')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('filter-mode-fields')).not.toBeInTheDocument();
  });

  it('offers None / Tabs / Dropdown only — Toggle is deprecated and not authorable (ADR-0047 §3.4a)', () => {
    render(<FilterMode value={undefined} onChange={() => {}} context={ctx} schema={{}} />);
    expect(screen.getByTestId('filter-mode-none')).toBeInTheDocument();
    expect(screen.getByTestId('filter-mode-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('filter-mode-dropdown')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-mode-toggle')).not.toBeInTheDocument();
  });

  it('keeps a deprecated element:"toggle" config editable (field picker still shows)', () => {
    render(<FilterMode value={{ element: 'toggle', fields: [{ field: 'is_active' }] }} onChange={() => {}} context={ctx} schema={{}} />);
    // No Toggle button to re-select, but its fields remain editable.
    expect(screen.queryByTestId('filter-mode-toggle')).not.toBeInTheDocument();
    expect(screen.getByTestId('filter-mode-fields')).toBeInTheDocument();
  });

  it('selecting None removes the config (onChange undefined)', () => {
    const onChange = vi.fn();
    render(<FilterMode value={{ element: 'dropdown', fields: [{ field: 'status' }] }} onChange={onChange} context={ctx} schema={{}} />);
    fireEvent.click(screen.getByTestId('filter-mode-none'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('selecting Dropdown sets element and reveals the field picker', () => {
    const onChange = vi.fn();
    render(<FilterMode value={undefined} onChange={onChange} context={ctx} schema={{}} />);
    fireEvent.click(screen.getByTestId('filter-mode-dropdown'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ element: 'dropdown' }));
  });

  it('dropdown mode renders existing fields and an add-field picker from the source object', () => {
    render(
      <FilterMode
        value={{ element: 'dropdown', fields: [{ field: 'status' }] }}
        onChange={() => {}}
        context={ctx}
        schema={{}}
      />,
    );
    const box = screen.getByTestId('filter-mode-fields');
    expect(box.textContent).toContain('status');
    expect(screen.getByTestId('filter-mode-add-field')).toBeInTheDocument();
  });

  it('tabs mode renders the visual tab-preset editor, not the field picker', () => {
    render(<FilterMode value={{ element: 'tabs' }} onChange={() => {}} context={ctx} schema={{}} />);
    expect(screen.getByTestId('filter-mode-tabs-editor')).toBeInTheDocument();
    expect(screen.getByTestId('filter-mode-add-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-mode-fields')).not.toBeInTheDocument();
  });

  it('Add tab appends a canonical { name, label, filter } preset', () => {
    const onChange = vi.fn();
    render(<FilterMode value={{ element: 'tabs' }} onChange={onChange} context={ctx} schema={{}} />);
    fireEvent.click(screen.getByTestId('filter-mode-add-tab'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        element: 'tabs',
        tabs: [expect.objectContaining({ name: expect.any(String), label: expect.any(String), filter: [] })],
      }),
    );
  });

  it('renders existing tab presets (canonical { name, label, filter })', () => {
    render(
      <FilterMode
        value={{
          element: 'tabs',
          tabs: [{ name: 'urgent', label: 'Urgent', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] }],
        }}
        onChange={() => {}}
        context={ctx}
        schema={{}}
      />,
    );
    expect(screen.getByTestId('tab-preset-0')).toBeInTheDocument();
    expect((screen.getByTestId('tab-label-0') as HTMLInputElement).value).toBe('Urgent');
    // The per-tab filter now uses the same unified FilterBuilder as the list
    // toolbar; its trigger summarizes the existing condition by field label.
    const tabFilter = screen.getByTestId('tab-0-filter');
    expect(tabFilter).toBeInTheDocument();
    expect(tabFilter.textContent).toContain('Priority');
  });

  it('normalizes a legacy { id, filters } tab into the canonical shape on edit', () => {
    const onChange = vi.fn();
    render(
      <FilterMode
        value={{ element: 'tabs', tabs: [{ id: 'done', label: 'Done', filters: [['status', 'equals', 'done']] }] }}
        onChange={onChange}
        context={ctx}
        schema={{}}
      />,
    );
    // editing the label triggers a canonical write: name re-derived from the
    // new label, legacy `filters` AST normalized to `filter` predicate objects.
    fireEvent.change(screen.getByTestId('tab-label-0'), { target: { value: 'Resolved' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        element: 'tabs',
        tabs: [expect.objectContaining({ name: 'resolved', label: 'Resolved', filter: [{ field: 'status', operator: 'equals', value: 'done' }] })],
      }),
    );
  });
});
