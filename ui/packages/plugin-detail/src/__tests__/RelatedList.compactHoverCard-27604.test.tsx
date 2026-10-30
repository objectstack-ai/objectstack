/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27604 — the name in a compact related row (the record page's
 * related column) shows the row record's hover card: hover or Space, its
 * declared highlights, one read when shown and none when the rows draw, and
 * its title opens the row exactly as a click on the name does.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedListCompactContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const TASK = {
  name: 'task',
  label: 'Task',
  icon: 'check-square',
  nameField: 'subject',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'done', label: 'Done' },
      ],
    },
    priority: { type: 'select', label: 'Priority', options: [{ value: 'high', label: 'High' }] },
    notes: { type: 'textarea', label: 'Notes' },
  },
  highlightFields: ['subject', 'status', 'priority'],
};
const rows = [
  { id: 'task-1', subject: 'Call Ada', status: 'open' },
  { id: 'task-2', subject: 'Send deck', status: 'done' },
];

function renderCompact() {
  const source = {
    find: vi.fn(async () => rows),
    findOne: vi.fn(async (_o: string, id: string) => ({ ...rows.find((r) => r.id === id), priority: 'high', notes: 'Bring the deck' })),
    getObjectSchema: vi.fn(async () => TASK),
  };
  const onRowClick = vi.fn();
  render(
    <RelatedListCompactContext.Provider value>
      <RelatedList
        title="Tasks"
        type="table"
        api="task"
        objectName="task"
        columns={[{ field: 'subject', label: 'Subject' }, { field: 'status', label: 'Status' }]}
        data={rows}
        onRowClick={onRowClick}
        dataSource={source as any}
      />
    </RelatedListCompactContext.Provider>,
  );
  return { source, onRowClick };
}

const nameOf = (text: string) =>
  Array.from(document.querySelectorAll('[data-related-card-row] button')).find((b) => b.textContent === text) as HTMLButtonElement;
const card = () => document.querySelector('[data-record-hover-card]') as HTMLElement | null;
const shownFields = () =>
  Array.from(document.querySelectorAll('[data-record-hover-card-field]')).map((el) => el.getAttribute('data-record-hover-card-field'));

describe('compact related row — the record hover card (objectstack#27604)', () => {
  it('hovering the name shows the row record\'s declared highlights; drawing the rows read none', async () => {
    const { source } = renderCompact();
    await waitFor(() => expect(nameOf('Call Ada')).toBeTruthy());
    const row = nameOf('Call Ada').closest('[data-related-card-row]')!;
    const before = row.innerHTML.replace(/ data-state="(open|closed)"/g, '');
    expect(source.findOne).not.toHaveBeenCalled();

    fireEvent.pointerOver(nameOf('Call Ada'), { pointerType: 'mouse' });
    await waitFor(() => expect(card()).not.toBeNull(), { timeout: 2000 });
    await waitFor(() => expect(shownFields()).toEqual(['status', 'priority']));

    expect(card()!.querySelector('[data-record-hover-card-title]')).toHaveTextContent('Call Ada');
    expect(card()!.querySelector('[data-record-hover-card-object-label]')).toHaveTextContent('Task');
    expect(source.findOne).toHaveBeenCalledTimes(1);
    // The row keeps its layout: the card floats outside it.
    expect(row.contains(card())).toBe(false);
    expect(row.innerHTML.replace(/ data-state="(open|closed)"/g, '')).toBe(before);
  });

  it('Space on the focused name shows the card without opening the row; Esc hides it', async () => {
    const { onRowClick } = renderCompact();
    await waitFor(() => expect(nameOf('Send deck')).toBeTruthy());
    const name = nameOf('Send deck');
    act(() => name.focus());
    fireEvent.keyDown(name, { key: ' ' });
    fireEvent.keyUp(name, { key: ' ' });
    await waitFor(() => expect(card()).not.toBeNull());
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.keyDown(name, { key: 'Escape' });
    await waitFor(() => expect(card()).toBeNull());
  });

  it('the card title opens the row the way a click on the name does', async () => {
    const { onRowClick } = renderCompact();
    await waitFor(() => expect(nameOf('Call Ada')).toBeTruthy());
    fireEvent.keyDown(nameOf('Call Ada'), { key: ' ' });
    await waitFor(() => expect(card()?.querySelector('[data-record-hover-card-title]')).toBeTruthy());

    fireEvent.click(card()!.querySelector('[data-record-hover-card-title]')!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'task-1' });
    await waitFor(() => expect(card()).toBeNull());
  });
});
