// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { WIDGETS } from './widgets';

afterEach(cleanup);

const Icon = WIDGETS['icon'];

/**
 * `icon` widget — a searchable Lucide icon picker for page/app/object `icon`
 * fields (replaces the raw text input). Built inline (no Radix portal) so the
 * trigger, search box and result grid all render eagerly in jsdom. The icon
 * previews lazy-load their SVG chunk and degrade to a fallback glyph, so these
 * tests assert on the catalog wiring rather than the rendered <svg>.
 */
describe('icon widget', () => {
  it('is registered in the WIDGETS map', () => {
    expect(Icon).toBeTypeOf('function');
  });

  it('renders a combobox trigger showing the current icon name', () => {
    render(<Icon value="calendar" onChange={() => {}} schema={{ type: 'string' }} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('calendar');
  });

  it('opens a search box and filters the icon grid by query', () => {
    render(<Icon value="" onChange={() => {}} schema={{ type: 'string' }} />);
    fireEvent.click(screen.getByRole('combobox'));

    const search = screen.getByLabelText('Search icons…');
    const before = screen.getAllByRole('option').length;
    expect(before).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: 'ampersand' } });
    const after = screen.getAllByRole('option');
    expect(after.length).toBeGreaterThan(0);
    expect(after.length).toBeLessThan(before);
    // Every surviving option matches the query.
    for (const opt of after) {
      expect(opt.getAttribute('title')).toContain('ampersand');
    }
  });

  it('writes the selected icon name through onChange', () => {
    const onChange = vi.fn();
    render(<Icon value="" onChange={onChange} schema={{ type: 'string' }} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.change(screen.getByLabelText('Search icons…'), { target: { value: 'ampersand' } });
    fireEvent.click(screen.getAllByRole('option')[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(String(onChange.mock.calls[0][0])).toContain('ampersand');
  });

  it('preserves an out-of-catalog value (renders it, offers a keep option)', () => {
    render(<Icon value="totally-made-up-icon" onChange={() => {}} schema={{ type: 'string' }} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('totally-made-up-icon');
    // Re-opening still surfaces the unknown value so it is never silently dropped.
    fireEvent.click(trigger);
    expect(
      screen.getAllByRole('option').some((o) => o.getAttribute('title') === 'totally-made-up-icon'),
    ).toBe(true);
  });
});
