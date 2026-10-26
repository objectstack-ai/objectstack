// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WIDGETS } from './widgets';

afterEach(cleanup);

const MultiSelect = WIDGETS['multiselect'];

// `appearance.allowedVisualizations` serialises (Zod z.enum) as
// { type: 'array', items: { type: 'string', enum: [...] } }.
const vizSchema = {
  type: 'array',
  items: { type: 'string', enum: ['grid', 'kanban', 'calendar', 'gallery'] },
};

/**
 * ADR-0047 multi-select widget — picks from a fixed option set (array of
 * enum) instead of the free-text tag fallback the generic array renderer
 * used. Author picks the real allowed values; can't mistype them.
 */
describe('multiselect widget', () => {
  it('renders a chip per enum value with humanised labels', () => {
    render(<MultiSelect value={[]} onChange={() => {}} schema={vizSchema} />);
    expect(screen.getByRole('checkbox', { name: 'Grid' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Gallery' })).toBeInTheDocument();
  });

  it('reflects the selected subset via aria-checked', () => {
    render(<MultiSelect value={['grid', 'kanban']} onChange={() => {}} schema={vizSchema} />);
    expect(screen.getByRole('checkbox', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Kanban' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('checkbox', { name: 'Calendar' })).toHaveAttribute('aria-checked', 'false');
  });

  it('toggling an option adds it, preserving enum declaration order', () => {
    const onChange = vi.fn();
    render(<MultiSelect value={['kanban']} onChange={onChange} schema={vizSchema} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grid' }));
    // grid precedes kanban in the enum → ordered output, not insertion order.
    expect(onChange).toHaveBeenCalledWith(['grid', 'kanban']);
  });

  it('toggling a selected option removes it', () => {
    const onChange = vi.fn();
    render(<MultiSelect value={['grid', 'kanban']} onChange={onChange} schema={vizSchema} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grid' }));
    expect(onChange).toHaveBeenCalledWith(['kanban']);
  });

  it('clearing the last option emits undefined (omit, not empty array)', () => {
    const onChange = vi.fn();
    render(<MultiSelect value={['grid']} onChange={onChange} schema={vizSchema} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Grid' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('is read-only when readOnly — clicks do not emit', () => {
    const onChange = vi.fn();
    render(<MultiSelect value={['grid']} onChange={onChange} schema={vizSchema} readOnly />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Kanban' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
