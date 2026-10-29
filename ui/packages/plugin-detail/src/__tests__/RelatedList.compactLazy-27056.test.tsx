/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27056, Target 2 — a compact related card reads its rows on
 * demand: the count its stack asked up front draws its header, a card counted
 * at 0 reads no rows at all, and a card above 0 reads its first three rows —
 * the name and the chip, nothing else — only once it comes into view.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedCardCountContext, RelatedListCompactContext } from '../relatedListCompact';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const schema = {
  name: 'task',
  nameField: 'subject',
  fields: {
    subject: { type: 'text', label: 'Subject' },
    status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
    due_on: { type: 'date', label: 'Due' },
    notes: { type: 'textarea', label: 'Notes' },
    account: { type: 'lookup', reference: 'account', label: 'Account' },
  },
};

const ROWS = [
  { id: 't1', subject: 'Call Ada', status: 'open' },
  { id: 't2', subject: 'Send deck', status: 'open' },
  { id: 't3', subject: 'Book demo', status: 'open' },
];

/** Every observed element intersects once `reveal()` is called — not before. */
let reveal: () => void = () => {};
class ManualObserver {
  constructor(private readonly cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
    reveal = () => this.cb([{ isIntersecting: true }]);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderCard(count: number | null, onEmptyChange?: (empty: boolean | null) => void) {
  const find = vi.fn(async () => ({ data: ROWS, total: 7 }));
  const dataSource = { find, getObjectSchema: vi.fn(async () => schema) };
  render(
    <RelatedListCompactContext.Provider value>
      <RelatedCardCountContext.Provider value={count}>
        <RelatedList
          title="Tasks"
          type="table"
          api="task"
          objectName="task"
          referenceField="account"
          parentId="acc-1"
          pageSize={5}
          onEmptyChange={onEmptyChange}
          dataSource={dataSource as any}
        />
      </RelatedCardCountContext.Provider>
    </RelatedListCompactContext.Provider>,
  );
  return find;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const header = () => document.querySelector('[data-related-card-count]')?.textContent;

describe('RelatedList compact card — rows on demand (objectstack#27056)', () => {
  it('a card counted at 0 reads no rows and is its title row alone', async () => {
    vi.stubGlobal('IntersectionObserver', ManualObserver);
    const onEmptyChange = vi.fn();
    const find = renderCard(0, onEmptyChange);
    await flush();
    act(() => reveal());
    await flush();
    expect(find).not.toHaveBeenCalled();
    expect(header()).toBe('0');
    expect(document.querySelector('[data-related-card-row]')).toBeNull();
    expect(document.querySelector('[data-related-card-row-pending]')).toBeNull();
    // Its stack's empty fold hears "empty" from the count, without a read.
    expect(onEmptyChange).toHaveBeenLastCalledWith(true);
  });

  it('a counted card out of view draws its count and placeholders, and reads nothing', async () => {
    vi.stubGlobal('IntersectionObserver', ManualObserver);
    const onEmptyChange = vi.fn();
    const find = renderCard(7, onEmptyChange);
    await flush();
    expect(find).not.toHaveBeenCalled();
    expect(header()).toBe('7');
    expect(document.querySelectorAll('[data-related-card-row-pending]')).toHaveLength(3);
    expect(onEmptyChange).toHaveBeenLastCalledWith(false);
  });

  it('in view, it reads its first three rows: the name and the chip, nothing more', async () => {
    vi.stubGlobal('IntersectionObserver', ManualObserver);
    const find = renderCard(7);
    await flush();
    expect(find).not.toHaveBeenCalled();
    act(() => reveal());
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    const [object, query] = find.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(object).toBe('task');
    expect(query.$top).toBe(3);
    expect(query.$skip).toBe(0);
    expect(query.$select).toEqual(['id', 'subject', 'status']);
    expect(query.$expand).toBeUndefined();
    await waitFor(() => expect(document.querySelectorAll('[data-related-card-row]')).toHaveLength(3));
    expect(header()).toBe('7');
  });

  it('uncounted and with no IntersectionObserver (SSR, tests), it reads at once as before', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const find = renderCard(null);
    await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(header()).toBe('7'));
  });
});
