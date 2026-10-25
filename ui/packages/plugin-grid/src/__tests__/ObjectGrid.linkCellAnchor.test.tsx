/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4490 — the list's `link: true` column renders a REAL anchor when the
 * host publishes record URLs.
 *
 * The column was a `span role="link"` with no `href`, navigating only through
 * `navigation.handleClick(row)`. So the one surface users open records from had
 * none of a link's native affordances — no middle-click / ⌘-click open-in-new-
 * tab, no "copy link address", no hover status-bar URL — and `role="link"`
 * without an href is a weaker contract for assistive tech than an anchor. PR
 * #4489 had just given detail-page and related-list lookup VALUES real anchors,
 * which left the list column as the weakest of the three surfaces.
 *
 * The mechanism is #4489's, unchanged: the host publishes its own record-URL
 * builder on `RelatedRecordActionsContext` (`recordHref`), the renderer never
 * assembles a URL, and the click splits — plain left click is prevented and
 * handed to the existing SPA path, modifier / non-primary clicks are left to
 * the browser.
 *
 * RED-FIRST — the fix was committed, then `ObjectGrid.tsx` and `ObjectView.tsx`
 * were reverted to `origin/main` with these tests kept. MEASURED, 5 red / 7
 * green in this file:
 *   ✗ renders a real anchor at the host-built record URL
 *       → AssertionError: expected null not to be null   (the span, no <a>)
 *   ✗ the auto-linked primary field gets the same anchor
 *       → expect(received).toHaveAttribute()  (received null)
 *   ✗ plain left click is prevented and takes the existing SPA path, exactly once
 *       → Unable to fire a "click" event - please provide a DOM element
 *   ✗ ⌘/Ctrl click is NOT prevented and does not run the SPA path
 *       → Unable to fire a "click" event - please provide a DOM element
 *   ✗ middle click is NOT prevented and does not run the SPA path
 *       → Unable to fire a "click" event - please provide a DOM element
 *
 * The three click cases fail by NOT FINDING the anchor rather than by
 * observing the wrong click behavior — worth stating, because it bounds what
 * they prove against `origin/main`: there, "no anchor" and "an anchor that
 * mishandles modifier clicks" are indistinguishable. They discriminate in the
 * FORWARD direction, pinning the split as `LinkCell` is edited from here on.
 *
 * The whole `must-not-change` block below, plus the two "host publishes no
 * href" cases, are GREEN in both worlds — that is what makes them controls
 * rather than a restatement of the fix.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, RelatedRecordActionsProvider } from '@object-ui/react';

registerAllFields();

const rows = [
  { id: 'r1', name: 'Alice', amount: 100, account_id: 'acc-1' },
  { id: 'r2', name: 'Bob', amount: 200, account_id: 'acc-2' },
];

/**
 * A host that can route to records, mirroring what `ObjectView` publishes for
 * the list surface (`listRecordActionsValue`): a URL for the object being
 * listed, `null` for anything else.
 */
function makeHost(overrides: Record<string, unknown> = {}) {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      objectName === 'test_object'
        ? `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`
        : null,
    openRecord: vi.fn(),
    ...overrides,
  } as any;
}

function renderGrid(opts?: Record<string, any>, host?: any) {
  const { onRowClick, ...schemaOverrides } = opts ?? {};
  const schema: any = {
    type: 'object-grid' as const,
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name', link: true },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: rows },
    ...schemaOverrides,
  };

  const grid = <ObjectGrid schema={schema} onRowClick={onRowClick} />;
  return render(
    <ActionProvider>
      {host === null ? grid : (
        <RelatedRecordActionsProvider value={host ?? makeHost()}>{grid}</RelatedRecordActionsProvider>
      )}
    </ActionProvider>,
  );
}

/** The first row's link cell, once the grid has rendered its columns. */
async function firstLinkCell(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText('Name')).toBeInTheDocument());
  const cells = await screen.findAllByTestId('link-cell');
  return cells[0] as HTMLElement;
}

describe('ObjectGrid link column — a real anchor when the host publishes record URLs (#4490)', () => {
  it('renders a real anchor at the host-built record URL', async () => {
    const { container } = renderGrid();
    await firstLinkCell();

    const anchor = container.querySelector('a[data-testid="link-cell"]');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', '/apps/demo/test_object/record/r1');
    // Accessible name is the display text — the cell's content, unchanged.
    expect(anchor).toHaveAccessibleName('Alice');
    // Each row addresses its OWN record.
    const hrefs = Array.from(container.querySelectorAll('a[data-testid="link-cell"]')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual([
      '/apps/demo/test_object/record/r1',
      '/apps/demo/test_object/record/r2',
    ]);
  });

  it('the auto-linked primary field gets the same anchor', async () => {
    const { container } = renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
    });
    await waitFor(() => expect(screen.getByText('Name')).toBeInTheDocument());

    const anchor = container.querySelector('a[data-testid="primary-field-link"]');
    expect(anchor).toHaveAttribute('href', '/apps/demo/test_object/record/r1');
  });

  it('plain left click is prevented and takes the existing SPA path, exactly once', async () => {
    const onRowClick = vi.fn();
    const { container } = renderGrid({ onRowClick });
    await firstLinkCell();

    const anchor = container.querySelector('a[data-testid="link-cell"]')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(anchor, event);

    // The SPA handler ran once — and only once: the click must not ALSO reach
    // the row's own click handler underneath (that is what would open the
    // record twice, or open a second tab on a modifier click).
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: 'r1' });
    // Prevented, so the browser does not ALSO follow the href.
    expect(event.defaultPrevented).toBe(true);
  });

  it('⌘/Ctrl click is NOT prevented and does not run the SPA path — the browser opens the tab', async () => {
    const onRowClick = vi.fn();
    const { container } = renderGrid({ onRowClick });
    await firstLinkCell();

    const anchor = container.querySelector('a[data-testid="link-cell"]')!;
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...modifier });
      fireEvent(anchor, event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('middle click is NOT prevented and does not run the SPA path', async () => {
    const onRowClick = vi.fn();
    const { container } = renderGrid({ onRowClick });
    await firstLinkCell();

    const anchor = container.querySelector('a[data-testid="link-cell"]')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 1 });
    fireEvent(anchor, event);

    expect(event.defaultPrevented).toBe(false);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('a host that cannot route to this object publishes no href — the span stays', async () => {
    const { container } = renderGrid({}, makeHost({ recordHref: () => null }));
    const cell = await firstLinkCell();

    expect(container.querySelector('a[data-testid="link-cell"]')).toBeNull();
    expect(cell.tagName).toBe('SPAN');
    expect(cell).toHaveAttribute('role', 'link');
  });

  it('a host published without `recordHref` at all publishes no href', async () => {
    const { container } = renderGrid({}, { resolve: () => ({}) } as any);
    const cell = await firstLinkCell();

    expect(container.querySelector('a[data-testid="link-cell"]')).toBeNull();
    expect(cell.tagName).toBe('SPAN');
  });
});

describe('ObjectGrid link column — must-not-change (#4490)', () => {
  /**
   * The graceful-degradation pin. A provider-less host (the Studio designer, an
   * embedded renderer, a standalone grid) must render the cell it rendered
   * before this change — asserted as the full markup, not just "no anchor", so
   * a stray class or attribute cannot slip in unnoticed.
   */
  it('no host: the link cell is the byte-identical `span role="link"`', async () => {
    const { container } = renderGrid({}, null);
    const cell = await firstLinkCell();

    expect(container.querySelector('a[data-testid="link-cell"]')).toBeNull();
    expect(cell.outerHTML).toBe(
      '<span role="link" tabindex="0" data-testid="link-cell" ' +
        'class="text-primary font-medium underline-offset-4 hover:underline cursor-pointer ' +
        'truncate block max-w-full">Alice</span>',
    );
  });

  it('no host: plain click still takes the SPA path, and does not double-fire', async () => {
    const onRowClick = vi.fn();
    const { container } = renderGrid({ onRowClick }, null);
    const cell = await firstLinkCell();

    fireEvent.click(cell);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(container.querySelector('a[data-testid="link-cell"]')).toBeNull();
  });

  it('non-link columns are untouched — no anchor anywhere but the link column', async () => {
    const { container } = renderGrid();
    await firstLinkCell();

    const anchors = Array.from(container.querySelectorAll('a'));
    expect(anchors.every((a) => a.getAttribute('data-testid') === 'link-cell')).toBe(true);
    // The number column renders its value, with no link affordance.
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('100').closest('a')).toBeNull();
  });

  it('a lookup column pointing at ANOTHER object stays plain — this host cannot route there', async () => {
    const { container } = renderGrid({
      columns: [
        { field: 'name', label: 'Name', link: true },
        { field: 'account_id', label: 'Account', type: 'lookup', reference: 'crm_account' },
      ],
    });
    await firstLinkCell();

    // `recordHref('crm_account', …)` is null for this host, so #4489's lookup
    // link stays unrendered — exactly as it renders today.
    const anchors = Array.from(container.querySelectorAll('a'));
    expect(anchors.every((a) => a.getAttribute('data-testid') === 'link-cell')).toBe(true);
  });

  it('a row with no id gets no anchor — nothing to address', async () => {
    const { container } = renderGrid({
      data: { provider: 'value', items: [{ name: 'Nameless', amount: 1 }] },
    });
    await firstLinkCell();

    expect(container.querySelector('a[data-testid="link-cell"]')).toBeNull();
  });
});
