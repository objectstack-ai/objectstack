// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #2678 P2-5 — an `objectList` column may itself be a list (repeater-in-repeater).
 * Before this branch a nested array item property fell through to a plain text
 * cell that `String()`-joined the array and corrupted it on save. These tests
 * pin that a nested `stringList` / `numberList` / `objectList` column renders its
 * own editor and round-trips the nested array through `onCommit` as an array —
 * `numberList` coerced back to `number[]`, not the widget's display strings.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FlowObjectListField } from './FlowObjectListField';
import type { FlowConfigColumn } from './flow-node-config';

afterEach(cleanup);

const baseProps = {
  onCommit: vi.fn(),
  addLabel: 'Add',
  removeLabel: 'Remove',
  emptyLabel: 'None',
  itemLabel: 'Item',
};

describe('FlowObjectListField — nested stringList column', () => {
  const columns: FlowConfigColumn[] = [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'recipients', label: 'Recipients', kind: 'stringList' },
  ];

  it('renders the nested array as its own list editor (not a joined text cell)', () => {
    render(<FlowObjectListField label="Rules" columns={columns} value={[{ name: 'r1', recipients: ['a@x.com', 'b@x.com'] }]} {...baseProps} />);
    // Each nested item is its own input — a text cell would show "a@x.com,b@x.com".
    expect(screen.getByDisplayValue('a@x.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('b@x.com')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('a@x.com,b@x.com')).not.toBeInTheDocument();
  });

  it('round-trips an edit to a nested item as a string[] on the parent object', () => {
    const onCommit = vi.fn();
    render(<FlowObjectListField label="Rules" columns={columns} value={[{ name: 'r1', recipients: ['a@x.com'] }]} {...baseProps} onCommit={onCommit} />);
    const input = screen.getByDisplayValue('a@x.com');
    fireEvent.change(input, { target: { value: 'z@x.com' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalled();
    expect(onCommit.mock.calls.at(-1)![0]).toEqual([{ name: 'r1', recipients: ['z@x.com'] }]);
  });
});

describe('FlowObjectListField — nested numberList column', () => {
  const columns: FlowConfigColumn[] = [{ key: 'offsets', label: 'Offsets', kind: 'numberList' }];

  it('shows stored numbers as text and commits number[] (not the display strings)', () => {
    const onCommit = vi.fn();
    render(<FlowObjectListField label="Timers" columns={columns} value={[{ offsets: [1, 2] }]} {...baseProps} onCommit={onCommit} />);
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '5' } });
    fireEvent.blur(screen.getByDisplayValue('5'));
    expect(onCommit.mock.calls.at(-1)![0]).toEqual([{ offsets: [5, 2] }]);
  });
});

describe('FlowObjectListField — nested objectList column (repeater-in-repeater)', () => {
  const columns: FlowConfigColumn[] = [
    { key: 'label', label: 'Label', kind: 'text' },
    {
      key: 'members',
      label: 'Members',
      kind: 'objectList',
      columns: [{ key: 'user', label: 'User', kind: 'text' }],
    },
  ];

  it('renders a nested repeater row from the nested array', () => {
    render(<FlowObjectListField label="Groups" columns={columns} value={[{ label: 'mgr', members: [{ user: 'alice' }] }]} {...baseProps} />);
    expect(screen.getByDisplayValue('mgr')).toBeInTheDocument();
    // The doubly-nested member value renders through the recursive mount.
    expect(screen.getByDisplayValue('alice')).toBeInTheDocument();
  });
});
