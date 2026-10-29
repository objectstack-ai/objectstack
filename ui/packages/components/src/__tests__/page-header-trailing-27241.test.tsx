/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27241 — the host slot at the end of `page:header`'s action row.
 * The console's record view hands in the reader's panel switches through
 * `PageHeaderTrailingContext`; the row draws them as its LAST segment, after
 * the `⋯` menu, behind a vertical hairline, and wraps inside the header
 * (`max-w-full`) rather than running past a narrow page. No slot, no change:
 * the row is what it was.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { PageHeaderActions, PageHeaderTrailingContext } from '../index';

const RECORD = { id: 'lead-1', name: 'Ada' };
const SYSTEM = [
  { name: 'sys_edit', label: 'Edit', type: 'script', locations: ['record_header'], order: 100, onClick: () => {} },
  { name: 'sys_delete', label: 'Delete', type: 'script', locations: ['record_header'], order: 120, component: 'action:menu', onClick: () => {} },
];

function inRecord(node: React.ReactNode, headerSystemActions: unknown[] = SYSTEM) {
  return (
    <ActionProvider>
      <RecordContextProvider
        objectName="lead"
        recordId={RECORD.id}
        data={RECORD}
        objectSchema={{ name: 'lead', label: 'Lead' }}
        headerSystemActions={headerSystemActions as never}
      >
        {node}
      </RecordContextProvider>
    </ActionProvider>
  );
}

const SWITCHES = <div data-testid="switches">switches</div>;

afterEach(() => cleanup());

describe('page:header — the trailing host slot (objectstack#27241)', () => {
  it('draws the slot as the toolbar’s last segment, after ⋯, behind a vertical hairline', () => {
    const PageHeader = ComponentRegistry.get('page:header')!;
    const { container, getByTestId } = render(
      inRecord(
        <PageHeaderTrailingContext.Provider value={SWITCHES}>
          <PageHeader schema={{ type: 'page:header' }} />
        </PageHeaderTrailingContext.Provider>,
      ),
    );
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const trailing = toolbar.lastElementChild!;
    expect(trailing.hasAttribute('data-page-header-trailing')).toBe(true);
    expect(trailing.contains(getByTestId('switches'))).toBe(true);
    const rule = trailing.querySelector('[role="separator"]')!;
    expect(rule.getAttribute('aria-orientation')).toBe('vertical');
    // The ⋯ trigger comes before the segment.
    const more = toolbar.querySelector('[aria-label="More actions"]')!;
    expect(more.compareDocumentPosition(trailing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The row wraps inside the header instead of overflowing it.
    expect(toolbar.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex-wrap', 'shrink-0', 'max-w-full']));
  });

  it('with no action the row is the slot alone, with no hairline', () => {
    const { container, getByTestId } = render(inRecord(<PageHeaderActions trailing={SWITCHES} />, []));
    const toolbar = container.querySelector('[role="toolbar"]')!;
    expect(toolbar.contains(getByTestId('switches'))).toBe(true);
    expect(toolbar.querySelector('[role="separator"]')).toBeNull();
  });

  it('no slot: no trailing segment, and the empty slot still stands in for an empty row', () => {
    const PageHeader = ComponentRegistry.get('page:header')!;
    const withActions = render(inRecord(<PageHeader schema={{ type: 'page:header' }} />));
    expect(withActions.container.querySelector('[data-page-header-trailing]')).toBeNull();
    cleanup();
    const empty = render(inRecord(<PageHeaderActions emptySlot={<span data-testid="empty" />} />, []));
    expect(empty.container.querySelector('[role="toolbar"]')).toBeNull();
    expect(empty.getByTestId('empty')).toBeTruthy();
  });
});
