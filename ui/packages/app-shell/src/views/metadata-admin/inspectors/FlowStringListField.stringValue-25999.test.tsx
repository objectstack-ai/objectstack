// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25999 — a stored bare string reads as a one-entry list.
 *
 * A notify node's `channels` is `string | string[]` in the spec, and the
 * runtime reads `channels: 'email'` as `['email']`. The field used to read any
 * non-array value as an empty list: it showed "no entries", and adding a
 * channel committed a list without `email`, silently dropping it.
 *
 * The cases read the rendered rows and the committed value, never the internal
 * list, so an implementation that parses the string but fails to show or keep
 * it still fails here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FlowStringListField } from './FlowStringListField';

afterEach(cleanup);

const LABELS = {
  label: 'Channels',
  addLabel: 'Add',
  itemLabel: 'Item',
  removeLabel: 'Remove',
  emptyLabel: 'No entries',
};

function rowValues(): string[] {
  return screen.queryAllByPlaceholderText('Item').map((el) => (el as HTMLInputElement).value);
}

describe('FlowStringListField — stored string value (#25999)', () => {
  it('shows a stored string as one row', () => {
    render(<FlowStringListField {...LABELS} value="email" onCommit={vi.fn()} />);
    expect(rowValues()).toEqual(['email']);
    expect(screen.queryByText('No entries')).toBeNull();
  });

  it('keeps the stored entry when another one is added, committing the list form', () => {
    const onCommit = vi.fn();
    render(<FlowStringListField {...LABELS} value="email" onCommit={onCommit} />);

    fireEvent.click(screen.getByText('Add'));
    const inputs = screen.getAllByPlaceholderText('Item');
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[1], { target: { value: 'sms' } });
    fireEvent.blur(inputs[1]);

    expect(onCommit).toHaveBeenLastCalledWith(['email', 'sms']);
  });

  it('removing the only entry of a stored string commits undefined', () => {
    const onCommit = vi.fn();
    render(<FlowStringListField {...LABELS} value="email" onCommit={onCommit} />);

    fireEvent.click(screen.getByLabelText('Remove'));

    expect(onCommit).toHaveBeenLastCalledWith(undefined);
    expect(rowValues()).toEqual([]);
  });

  it('trims the stored string, as the runtime does', () => {
    render(<FlowStringListField {...LABELS} value="  email " onCommit={vi.fn()} />);
    expect(rowValues()).toEqual(['email']);
  });

  it('reads a blank string as empty', () => {
    render(<FlowStringListField {...LABELS} value="   " onCommit={vi.fn()} />);
    expect(rowValues()).toEqual([]);
    expect(screen.getByText('No entries')).toBeTruthy();
  });

  it('still reads a stored list as its rows', () => {
    render(<FlowStringListField {...LABELS} value={['inbox', 'email']} onCommit={vi.fn()} />);
    expect(rowValues()).toEqual(['inbox', 'email']);
  });

  it('does not commit on render, so an untouched string stays as stored', () => {
    const onCommit = vi.fn();
    render(<FlowStringListField {...LABELS} value="email" onCommit={onCommit} />);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
