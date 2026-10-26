/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4336 — a lookup value rendered read-only was plain text: the record
 * detail page showed `TYG1WX20260812001001` with a copy button and no way to
 * reach the referenced work order, and the related list's lookup columns had
 * the same dead cells (the reporter's own check: no `<a>` anywhere over the
 * value, every `href` null).
 *
 * `LookupCellRenderer` is the ONE cell renderer both surfaces resolve through
 * (`DetailSection` and `RelatedList` each call `getCellRenderer('lookup')`), so
 * the link belongs here — same path, both halves.
 *
 * The href is NOT assembled here. This package has no router and no idea what
 * an app's record route looks like; the host that owns record URLs publishes
 * them through `RelatedRecordActionsContext` (`recordHref` / `openRecord`),
 * which is the same builder the related list's row navigation already uses. No
 * host → no link, and the value renders exactly as it did before.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { LookupCellRenderer } from '../index';
import { RelatedRecordActionsProvider } from '@object-ui/react';

/** The reporter's shape: `$expand`-ed lookup value (display name + record id). */
const WORK_ORDER = { id: 'wo-1', name: 'TYG1WX20260812001001' };
const FIELD = { type: 'lookup', reference: 'mtc_work_order' } as any;

/** A host that can route to records, mirroring the console bridge's shape. */
function makeHost(overrides: Record<string, unknown> = {}) {
  return {
    resolve: () => ({}),
    recordHref: (objectName: string, recordId: string | number) =>
      `/apps/demo/${objectName}/record/${encodeURIComponent(String(recordId))}`,
    openRecord: vi.fn(),
    ...overrides,
  } as any;
}

function renderWithHost(node: React.ReactElement, host: any = makeHost()) {
  return render(
    <RelatedRecordActionsProvider value={host}>{node}</RelatedRecordActionsProvider>,
  );
}

describe('LookupCellRenderer — the value links to the referenced record (#4336)', () => {
  it('expanded value: renders an anchor at the host-built record href', () => {
    const { container } = renderWithHost(
      <LookupCellRenderer value={WORK_ORDER} field={FIELD} />,
    );

    const anchor = container.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('href', '/apps/demo/mtc_work_order/record/wo-1');
    // Display-name resolution is untouched — the anchor carries the same text.
    expect(anchor).toHaveTextContent('TYG1WX20260812001001');
  });

  it('primitive id value: links through the same host builder', () => {
    const { container } = renderWithHost(
      <LookupCellRenderer
        value="wo-2"
        field={{ ...FIELD, options: [{ value: 'wo-2', label: 'TYG1WX20260812001002' }] }}
      />,
    );

    const anchor = container.querySelector('a');
    expect(anchor).toHaveAttribute('href', '/apps/demo/mtc_work_order/record/wo-2');
    expect(anchor).toHaveTextContent('TYG1WX20260812001002');
  });

  it('multi-value: each referenced record gets its own anchor', () => {
    const { container } = renderWithHost(
      <LookupCellRenderer
        value={[WORK_ORDER, { id: 'wo-3', name: 'TYG1WX20260812001003' }]}
        field={FIELD}
      />,
    );

    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/apps/demo/mtc_work_order/record/wo-1',
      '/apps/demo/mtc_work_order/record/wo-3',
    ]);
  });

  it('plain click navigates through the host (SPA) instead of reloading', () => {
    const host = makeHost();
    const rowClick = vi.fn();
    const { container } = render(
      <RelatedRecordActionsProvider value={host}>
        {/* The surfaces around this cell carry their own click handlers — the
            detail row copies the value, a related-list row opens the row's own
            record. Activating the link must do neither. */}
        <div onClick={rowClick}>
          <LookupCellRenderer value={WORK_ORDER} field={FIELD} />
        </div>
      </RelatedRecordActionsProvider>,
    );

    const anchor = container.querySelector('a')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(anchor, event);

    expect(host.openRecord).toHaveBeenCalledWith('mtc_work_order', 'wo-1');
    expect(event.defaultPrevented).toBe(true);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('modifier click keeps the browser default (open in a new tab)', () => {
    const host = makeHost();
    const { container } = renderWithHost(
      <LookupCellRenderer value={WORK_ORDER} field={FIELD} />,
      host,
    );

    const anchor = container.querySelector('a')!;
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    fireEvent(anchor, event);

    expect(host.openRecord).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('LookupCellRenderer — must-not-change (#4336)', () => {
  it('no host: renders exactly as before, with no anchor', () => {
    const { container } = render(<LookupCellRenderer value={WORK_ORDER} field={FIELD} />);

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('TYG1WX20260812001001')).toBeInTheDocument();
  });

  it('host cannot route to the target object: no anchor, same text', () => {
    const { container } = renderWithHost(
      <LookupCellRenderer value={WORK_ORDER} field={FIELD} />,
      makeHost({ recordHref: () => null }),
    );

    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('TYG1WX20260812001001')).toBeInTheDocument();
  });

  it('no reference target declared: no anchor', () => {
    const { container } = renderWithHost(
      <LookupCellRenderer value={WORK_ORDER} field={{ type: 'lookup' } as any} />,
    );

    expect(container.querySelector('a')).toBeNull();
  });

  it('empty value: the placeholder stays a placeholder — no empty link', () => {
    const { container } = renderWithHost(<LookupCellRenderer value={null} field={FIELD} />);

    expect(container.querySelector('a')).toBeNull();
  });
});
