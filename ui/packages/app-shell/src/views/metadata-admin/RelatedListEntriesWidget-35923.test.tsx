// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35923 (review M1): the generic object form's `relatedLists`
 * row. An entry is a bare name or `{ list, label?, columns? }` (#35897,
 * #35899); the row used `string-tags`, which renders each element as a React
 * child, so an object entry written by Studio's Record page tabs editor broke
 * the form. The row now names `related-list-entries`, which keeps every
 * entry's stored form.
 */

// The source under test reaches these through dynamic imports: their first load is paid at collection.
import '@objectstack/formula';
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { objectForm } from '@objectstack/spec/data';
import { WIDGETS } from './widgets';

afterEach(cleanup);

const Entries = WIDGETS['related-list-entries'];
const objectEntry = { list: 'quote_line', label: 'Line items', columns: ['product', 'amount'] };

/** The `relatedLists` row of the published object form, wherever its section puts it. */
function relatedListsRow(): { widget?: string; helpText?: string } | undefined {
  const rows: Array<{ field?: string; widget?: string; helpText?: string }> = [];
  for (const section of (objectForm as { sections?: Array<{ fields?: unknown[] }> }).sections ?? []) {
    for (const f of section.fields ?? []) if (f && typeof f === 'object') rows.push(f as never);
  }
  return rows.find((r) => r.field === 'relatedLists');
}

describe('relatedLists on the generic object form (objectstack#35923 M1)', () => {
  it('the published row names the entries widget, and its help text states the tab-list meaning', () => {
    const row = relatedListsRow();
    expect(row?.widget).toBe('related-list-entries');
    expect(row?.helpText).toContain('shows no tab');
    expect(row?.helpText).not.toContain('the rest follow');
  });

  it('renders an object entry beside a bare one, with its title and columns', () => {
    render(<Entries value={['task', objectEntry]} onChange={() => {}} schema={{}} />);
    expect(screen.getByTestId('related-list-entry-task')).toHaveTextContent('task');
    const chip = screen.getByTestId('related-list-entry-quote_line');
    expect(chip).toHaveTextContent('quote_line');
    expect(chip).toHaveTextContent('Line items');
    expect(chip).toHaveTextContent('product, amount');
  });

  it('removing a bare entry keeps the object entry as stored; adding appends a bare name', () => {
    const onChange = vi.fn();
    render(<Entries value={['task', objectEntry]} onChange={onChange} schema={{}} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(onChange).toHaveBeenLastCalledWith([objectEntry]);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'sys_activity' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['task', objectEntry, 'sys_activity']);
  });

  it('does not add a second entry for a name an object entry already places', () => {
    const onChange = vi.fn();
    render(<Entries value={[objectEntry]} onChange={onChange} schema={{}} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'quote_line' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith([objectEntry]);
  });

  it('removing the last entry removes the key', () => {
    const onChange = vi.fn();
    render(<Entries value={[objectEntry]} onChange={onChange} schema={{}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
