/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12906 — `PageHeaderActions` is `page:header`'s own action row,
 * lifted so a host can draw it where a page has no `page:header` (the
 * console's print-page chrome). It is the ONE resolver for both surfaces, so
 * for the same record context and the same authored keys it draws the same
 * row `page:header` draws, and an empty row falls back to the slot it is
 * handed, as `page:header`'s tail always did.
 */

import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { PageHeaderActions } from '../index';

const RECORD = { id: 'lead-1', name: 'Ada', status: 'open' };
const OBJECT_SCHEMA = { name: 'lead', label: 'Lead' };
const DECLARED = [
  { name: 'convert', label: 'Convert Lead', type: 'flow', locations: ['record_header'] },
  { name: 'qualify', label: 'Qualify', type: 'flow', locations: ['record_header'], visible: 'record.status == "open"' },
  { name: 'archive', label: 'Archive', type: 'flow', locations: ['record_more'] },
  { name: 'hidden_one', label: 'Never', type: 'flow', locations: ['record_header'], visible: false },
  { name: 'list_only', label: 'List Only', type: 'flow', locations: ['list_item'] },
];
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
        objectSchema={OBJECT_SCHEMA}
        headerSystemActions={headerSystemActions as never}
      >
        {node}
      </RecordContextProvider>
    </ActionProvider>
  );
}

/** The toolbar's controls, by accessible name, in document order. */
function rowOf(container: HTMLElement): string[] {
  const toolbar = container.querySelector('[role="toolbar"]');
  expect(toolbar).not.toBeNull();
  return Array.from(toolbar!.querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? (b.textContent ?? '').trim(),
  );
}

/** The toolbar's markup with React's per-tree ids blanked. */
function toolbarMarkup(container: HTMLElement): string {
  const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
  return toolbar.outerHTML.replace(/(id|aria-controls|aria-describedby|aria-labelledby)="[^"]*"/g, '$1=""');
}

describe('PageHeaderActions — page:header’s action row, shared (objectui#12906)', () => {
  it('draws the row page:header draws for the same record context and authored keys', () => {
    const PageHeader = ComponentRegistry.get('page:header')!;
    const viaHeader = render(inRecord(<PageHeader schema={{ type: 'page:header', actions: DECLARED, maxVisible: 1 }} />));
    const headerRow = rowOf(viaHeader.container);
    const headerMarkup = toolbarMarkup(viaHeader.container);
    cleanup();

    const viaShared = render(inRecord(<PageHeaderActions actions={DECLARED} maxVisible={1} />));
    expect(rowOf(viaShared.container)).toEqual(headerRow);
    expect(toolbarMarkup(viaShared.container)).toBe(headerMarkup);
    // The gates ran: the declared inline action, the host's Edit, the ⋯.
    expect(headerRow).toEqual(['Convert Lead', 'Edit', 'More actions']);
  });

  it('draws the host system set alone when no action is declared', () => {
    const { container } = render(inRecord(<PageHeaderActions />));
    expect(rowOf(container)).toEqual(['Edit', 'More actions']);
  });

  it('draws the slot it is handed when no action survives', () => {
    const { container } = render(
      inRecord(<PageHeaderActions actions={[]} emptySlot={<div data-testid="empty-slot" />} />, []),
    );
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector('[data-testid="empty-slot"]')).not.toBeNull();
  });
});
