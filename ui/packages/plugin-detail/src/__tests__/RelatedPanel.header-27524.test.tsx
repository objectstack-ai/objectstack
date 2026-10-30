/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27524 — a related panel of the record page's related column,
 * drawn by the REAL `RelatedList` compact face with the arranged stack's
 * chrome:
 *
 *  - Target 1: the header is the title, then the count chip; the row (or the
 *    chip) opens the whole list through ONE button stretched over the row,
 *    and its title says 「查看全部 N 条」; ⠿ ＋ ⋯ sit
 *    at the RIGHT end, drawn on hover or focus; ⋯ holds 隐藏 alone; no
 *    collapse, no ⤢; ⌥↑ / ⌥↓ on the focused handle move the panel.
 *  - Target 11: the compact row's first column skips the foreign key that
 *    points back at this record.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import { RelatedList } from '../RelatedList';
import { RelatedCardChromeContext, RelatedListCompactContext, type RelatedCardChrome } from '../relatedListCompact';

// Desktop, pinned rather than inherited: below 768 px a table list renders as a gallery.
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
afterEach(cleanup);

const fields = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
};
const rows = [
  { id: 't1', name: 'Call Ada', status: 'open' },
  { id: 't2', name: 'Send deck', status: 'open' },
];

const chromeOf = (over: Partial<RelatedCardChrome> = {}): RelatedCardChrome => ({
  id: 'task.lead_id',
  fresh: false,
  onHide: vi.fn(),
  onEnlarge: vi.fn(),
  onMoveUp: vi.fn(),
  onMoveDown: vi.fn(),
  ...over,
});

function renderPanel(chrome: RelatedCardChrome, extra: { onNew?: () => void } = {}) {
  return render(
    <RelatedListCompactContext.Provider value>
      <RelatedCardChromeContext.Provider value={chrome}>
        <RelatedList
          title="Tasks"
          type="table"
          api="task"
          objectName="task"
          data={rows}
          onNew={extra.onNew}
          dataSource={{ find: vi.fn(async () => rows), getObjectSchema: vi.fn(async () => ({ name: 'task', fields })) } as any}
        />
      </RelatedCardChromeContext.Provider>
    </RelatedListCompactContext.Provider>,
  );
}

const head = () => document.querySelector('[data-related-panel-head]') as HTMLElement;

describe('the related panel header (objectstack#27524, Target 1)', () => {
  it('is the title, then the count chip; nothing reserved on the left, no chevron toggle, no ⤢', async () => {
    renderPanel(chromeOf(), { onNew: vi.fn() });
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    const open = head().querySelector('[data-related-panel-open]')!;
    expect(head().firstElementChild).toBe(open);
    expect(open.firstElementChild?.textContent).toBe('Tasks');
    expect(open.querySelector('[data-related-card-count]')?.textContent).toBe('2');
    // No collapse toggle and no enlarge button anywhere in the header (the ⋯
    // trigger's own aria-expanded is the menu's).
    expect(head().querySelector('[aria-expanded]:not([data-related-card-menu])')).toBeNull();
    expect(head().querySelector('[data-related-card-enlarge]')).toBeNull();
    // The title says where the row goes: 「查看全部 N 条」.
    expect(open.getAttribute('title')).toBe('View all 2');
  });

  it('the header row, its title and its count chip open the whole list', async () => {
    const chrome = chromeOf();
    renderPanel(chrome);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    const open = head().querySelector('[data-related-panel-open]') as HTMLButtonElement;
    fireEvent.click(open);
    fireEvent.click(head().querySelector('[data-related-card-count]')!);
    expect(chrome.onEnlarge).toHaveBeenCalledTimes(2);
    // The row is one control, not a clickable div: the button's ::after
    // stretches over the positioned header, and the controls sit above it.
    expect(open.tagName).toBe('BUTTON');
    expect(open.className).toContain('after:absolute');
    expect(open.className).toContain('after:inset-0');
    expect(head().className).toMatch(/\brelative\b/);
    const controls = head().querySelector('[data-related-panel-controls]') as HTMLElement;
    expect(controls.className).toMatch(/\brelative\b/);
    expect(controls.className).toContain('z-10');
    // No transform on the button, ever: the console scales a pressed button
    // (`button:active { transform: scale(0.96) }`), and a transformed button
    // is the containing block of its own ::after, which then shrinks to the
    // button mid-press, so a press on the row's free space released on the
    // header and opened nothing (proxy preview review, PR #27920). jsdom has
    // no :active or layout, so the pin is the inline override itself.
    expect(open.style.transform).toBe('none');
  });

  it('⠿ ＋ ⋯ sit at the right end, shown on hover or focus; their clicks do not open the list', async () => {
    const chrome = chromeOf();
    const onNew = vi.fn();
    renderPanel(chrome, { onNew });
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    const controls = head().querySelector('[data-related-panel-controls]') as HTMLElement;
    expect(head().lastElementChild).toBe(controls);
    expect(controls.className).toMatch(/\bopacity-0\b/);
    expect(controls.className).toContain('group-hover/panel-head:opacity-100');
    expect(controls.className).toContain('group-focus-within/panel-head:opacity-100');
    const order = Array.from(controls.querySelectorAll('button')).map((b) =>
      b.hasAttribute('data-related-panel-handle') ? 'handle' : b.hasAttribute('data-related-card-menu') ? 'menu' : b.getAttribute('data-testid'),
    );
    expect(order).toEqual(['handle', 'related-list-new', 'menu']);
    fireEvent.click(controls.querySelector('[data-testid="related-list-new"]')!);
    fireEvent.click(controls.querySelector('[data-related-panel-handle]')!);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(chrome.onEnlarge).not.toHaveBeenCalled();
  });

  it('⋯ holds 隐藏 and nothing else', async () => {
    const chrome = chromeOf();
    renderPanel(chrome);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(head().querySelector('[data-related-card-menu]')!);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Hide']);
    // The menu's content is portaled: the controls stay drawn while it is open.
    expect(head().querySelector('[data-related-card-menu]')?.getAttribute('data-state')).toBe('open');
    expect((head().querySelector('[data-related-panel-controls]') as HTMLElement).className).toContain(
      'has-[[data-state=open]]:opacity-100',
    );
    await user.click(items[0]);
    expect(chrome.onHide).toHaveBeenCalledTimes(1);
    expect(chrome.onEnlarge).not.toHaveBeenCalled();
  });

  it('⌥↑ / ⌥↓ on the focused handle move the panel; a bare arrow does not', async () => {
    const chrome = chromeOf();
    renderPanel(chrome);
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    const handle = head().querySelector('[data-related-panel-handle]') as HTMLButtonElement;
    expect(handle.getAttribute('aria-label')).toBe('Reorder Tasks');
    expect(handle.getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
    act(() => handle.focus());
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(chrome.onMoveUp).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(handle, { key: 'ArrowDown', altKey: true });
    expect(chrome.onMoveUp).toHaveBeenCalledTimes(1);
    expect(chrome.onMoveDown).toHaveBeenCalledTimes(1);
  });

  it('the handle is the drag source on desktop, not the header row', async () => {
    const onDragStart = vi.fn();
    renderPanel(chromeOf({ dragHandleProps: { draggable: true, onDragStart } }));
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(head().getAttribute('draggable')).toBeNull();
    const handle = head().querySelector('[data-related-panel-handle]')!;
    expect(handle.getAttribute('draggable')).toBe('true');
  });
});

describe('the arranged full face (the Related tab) has no collapse either (objectstack#27524)', () => {
  it('draws ⠿ and ⋯, no chevron, and a click on its header leaves the rows drawn', async () => {
    render(
      <RelatedCardChromeContext.Provider value={chromeOf()}>
        <RelatedList
          title="Tasks"
          type="table"
          api="task"
          objectName="task"
          data={rows}
          dataSource={{ find: vi.fn(async () => rows), getObjectSchema: vi.fn(async () => ({ name: 'task', fields })) } as any}
        />
      </RelatedCardChromeContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText('Call Ada')).toBeInTheDocument());
    expect(document.querySelector('[data-related-panel-handle]')).not.toBeNull();
    expect(document.querySelector('[data-related-card-menu]')).not.toBeNull();
    expect(document.querySelector('.lucide-chevron-down, .lucide-chevron-right')).toBeNull();
    fireEvent.click(screen.getByText('Tasks'));
    expect(screen.getByText('Call Ada')).toBeInTheDocument();
  });
});

describe('the compact row’s first column (objectstack#27524, Target 11)', () => {
  // A product's line items: the child's name field IS the key back to the product.
  const lineFields = {
    product: { type: 'lookup', label: 'Product', reference: 'product' },
    opportunity: { type: 'lookup', label: 'Opportunity', reference: 'opportunity' },
    quantity: { type: 'number', label: 'Qty' },
  };
  const lineRows = [
    { id: 'l1', product: { id: 'p1', name: 'Widget' }, opportunity: { id: 'o1', name: 'Acme renewal' }, quantity: 2 },
    { id: 'l2', product: { id: 'p1', name: 'Widget' }, opportunity: { id: 'o2', name: 'Globex pilot' }, quantity: 5 },
  ];
  const renderLines = (referenceField: string, columns?: string[]) =>
    render(
      <RelatedListCompactContext.Provider value>
        <RelatedList
          title="Line items"
          type="table"
          api="line_item"
          objectName="line_item"
          referenceField={referenceField}
          columns={columns as never}
          data={lineRows}
          dataSource={{
            find: vi.fn(async () => lineRows),
            getObjectSchema: vi.fn(async () => ({ name: 'line_item', nameField: 'product', fields: lineFields })),
          } as any}
        />
      </RelatedListCompactContext.Provider>,
    );
  const names = () =>
    Array.from(document.querySelectorAll('[data-related-card-row]')).map((row) => row.firstElementChild?.textContent);

  it('on the product page, names the first column that is not the key back to it', async () => {
    renderLines('product');
    await waitFor(() => expect(names()).toEqual(['Acme renewal', 'Globex pilot']));
  });

  it('the key is skipped even when it is the only authored column: the declared fields are read next', async () => {
    renderLines('product', ['product']);
    await waitFor(() => expect(names()).toEqual(['Acme renewal', 'Globex pilot']));
  });

  it('on the opportunity page, the name field is not that key: the row names the record as everywhere else', async () => {
    renderLines('opportunity');
    await waitFor(() => expect(names()).toEqual(['Widget', 'Widget']));
  });
});
