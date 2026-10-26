/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PersonRow } from './PersonRow';
import { SelectionTray } from './SelectionTray';

const amy = {
  id: 'u1',
  name: 'Amy Lin',
  email: 'amy@x.io',
  image: 'http://x/amy.png',
  primary_business_unit_id: { name: 'Sales' },
};
const bob = { id: 'u2', name: 'Bob Wu', email: 'bob@x.io' };

describe('PersonRow', () => {
  it('renders name, subtitle (dept · email) and initials fallback', () => {
    render(
      <PersonRow record={amy} subtitleFields={['primary_business_unit_id.name', 'email']} />,
    );
    expect(screen.getByText('Amy Lin')).toBeTruthy();
    expect(screen.getByText('Sales · amy@x.io')).toBeTruthy();
    // Avatar fallback initials render (image does not load in jsdom).
    expect(screen.getByText('AL')).toBeTruthy();
  });

  it('fires onSelect with the record on click', () => {
    const onSelect = vi.fn();
    render(<PersonRow record={amy} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('person-row'));
    expect(onSelect).toHaveBeenCalledWith(amy);
  });

  it('reflects selected state via aria-pressed', () => {
    const { rerender } = render(<PersonRow record={amy} selected={false} />);
    expect(screen.getByTestId('person-row').getAttribute('aria-pressed')).toBe('false');
    rerender(<PersonRow record={amy} selected />);
    expect(screen.getByTestId('person-row').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('SelectionTray', () => {
  it('shows a chip per selected record with a label', () => {
    render(<SelectionTray records={[amy, bob]} onRemove={vi.fn()} label="Selected (2)" />);
    expect(screen.getByText('Selected (2)')).toBeTruthy();
    expect(screen.getAllByTestId('selection-chip')).toHaveLength(2);
    expect(screen.getByText('Amy Lin')).toBeTruthy();
    expect(screen.getByText('Bob Wu')).toBeTruthy();
  });

  it('renders emptyText when nothing is selected', () => {
    render(<SelectionTray records={[]} onRemove={vi.fn()} emptyText="No one selected" />);
    expect(screen.getByText('No one selected')).toBeTruthy();
    expect(screen.queryByTestId('selection-chip')).toBeNull();
  });

  it('calls onRemove with the record id when the ✕ is clicked', () => {
    const onRemove = vi.fn();
    render(<SelectionTray records={[amy, bob]} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove Amy Lin'));
    expect(onRemove).toHaveBeenCalledWith('u1');
  });

  it('shows Clear all only when non-empty and fires onClear', () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <SelectionTray records={[]} onRemove={vi.fn()} onClear={onClear} clearLabel="Clear all" />,
    );
    expect(screen.queryByTestId('selection-clear')).toBeNull();
    rerender(
      <SelectionTray records={[amy, bob]} onRemove={vi.fn()} onClear={onClear} clearLabel="Clear all" />,
    );
    fireEvent.click(screen.getByTestId('selection-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('PersonRow — highlight + active', () => {
  it('wraps the matched substring in a <mark>', () => {
    const { container } = render(<PersonRow record={amy} highlightQuery="am" />);
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('Am');
  });

  it('renders plain text (no mark) when there is no query', () => {
    const { container } = render(<PersonRow record={amy} />);
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.getByText('Amy Lin')).toBeTruthy();
  });

  it('exposes the keyboard-active state via data-active', () => {
    const { rerender } = render(<PersonRow record={amy} active={false} />);
    expect(screen.getByTestId('person-row').getAttribute('data-active')).toBeNull();
    rerender(<PersonRow record={amy} active />);
    expect(screen.getByTestId('person-row').getAttribute('data-active')).toBe('true');
  });
});
