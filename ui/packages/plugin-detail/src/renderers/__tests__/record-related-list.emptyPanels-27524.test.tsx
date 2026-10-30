/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#27524, Target 2 — in the record page's related column the
 * related lists are panels, and the empty ones (0 rows) fold into ONE line:
 * 「还有 N 个空关联 · 名字 · … · 展开」. The non-empty panels keep their order;
 * 展开 brings the empty ones back in their places, each with its own header
 * controls, for the record it was pressed on (the next record a view steps
 * to folds again), so the line carries no New — and a panel with an `add` picker
 * folds too. Unlike the Related tab's line (#25895, pinned in
 * `record-related-list.emptyFold-25895.test.tsx`), a column whose panels are
 * all empty folds them as well.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  RecordContextProvider,
  RelatedRecordActionsProvider,
  SchemaRenderer,
  SchemaRendererProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import type { DataSource } from '@object-ui/types';
import { RelatedListCompactContext } from '../../relatedListCompact';
// Registers `record:related_list`, the block under test.
import '../../index';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

// A panel reads its rows once it is seen; with no IntersectionObserver every
// panel is seen at once (the case `RelatedList.compactLazy-27056` pins).
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Rows = Record<string, Array<Record<string, unknown>>>;

const makeDataSource = (rows: Rows) => ({
  find: vi.fn(async (object: string) => {
    const data = rows[object] ?? [];
    return { data, total: data.length };
  }),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: { name: { type: 'text', label: 'Name' } } })),
  onMutation: () => () => {},
});

const panel = (objectName: string, title: string, extra: Record<string, unknown> = {}) => ({
  type: 'record:related_list',
  properties: { objectName, title, relationshipField: 'contact_id', columns: ['name'], ...extra },
});

function mount(nodes: object[], rows: Rows) {
  const ds = makeDataSource(rows);
  const host: RelatedRecordActionsValue = { resolve: () => ({ onCreate: () => {} }) };
  const tree = (recordId: string) => (
    <SchemaRendererProvider dataSource={ds as unknown as DataSource}>
      <RecordContextProvider objectName="crm_contact" recordId={recordId} dataSource={ds as never}>
        <RelatedRecordActionsProvider value={host}>
          <RelatedListCompactContext.Provider value>
            {/* The related column: the panels are siblings in one container. */}
            <aside data-testid="column">
              {nodes.map((node, idx) => (
                <SchemaRenderer key={idx} schema={node as never} />
              ))}
            </aside>
          </RelatedListCompactContext.Provider>
        </RelatedRecordActionsProvider>
      </RecordContextProvider>
    </SchemaRendererProvider>
  );
  const r = render(tree('c1'));
  // The pane's ↓ ↑ swap the record in place: same view, same column element.
  const stepTo = (recordId: string) => r.rerender(tree(recordId));
  return { ...r, ds, stepTo };
}

const line = () => screen.queryByTestId('record-related-panels-empty-fold');
/** The panels drawn in the column, by title, in document order. */
const shownPanels = () =>
  Array.from(document.querySelectorAll('[data-related-card]'))
    .filter((el) => !el.closest('[hidden]'))
    .map((el) => el.getAttribute('aria-label'));

describe('the empty panels fold into one line (objectstack#27524, Target 2)', () => {
  it('「还有 N 个空关联 · 名字 · … · 展开」 after the panels with rows, which keep their order', async () => {
    const { ds } = mount(
      [panel('task', 'Tasks'), panel('quote', 'Quotes'), panel('opportunity', 'Opportunities'), panel('contract', 'Contracts', { add: { picker: { object: 'contract' } } })],
      { task: [{ id: 't1', name: 'Call Ada' }], opportunity: [{ id: 'o1', name: 'Acme renewal' }] },
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(line()).not.toBeNull());
    expect(shownPanels()).toEqual(['Tasks', 'Opportunities']);
    const text = line()!.textContent!.replace(/\s+/g, ' ');
    // The picker panel folds too: 展开 brings its ＋ back with it.
    expect(text).toBe('2 more empty lists·Quotes·Contracts·Expand');
    // The line names the panels; it carries no New of its own.
    expect(line()!.querySelectorAll('button')).toHaveLength(1);
  });

  it('展开 brings the empty panels back in their places, and the line goes', async () => {
    const { ds } = mount([panel('task', 'Tasks'), panel('quote', 'Quotes'), panel('opportunity', 'Opportunities')], {
      task: [{ id: 't1', name: 'Call Ada' }],
    });
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(line()).not.toBeNull());
    fireEvent.click(line()!.querySelector('[data-related-empty-fold-expand]')!);
    expect(line()).toBeNull();
    expect(shownPanels()).toEqual(['Tasks', 'Quotes', 'Opportunities']);
  });

  it('展开 is for the record it was pressed on: stepping to a sibling in the same view folds again', async () => {
    const column = { task: [{ id: 't1', name: 'Call Ada' }] };
    const { ds, stepTo } = mount([panel('task', 'Tasks'), panel('quote', 'Quotes'), panel('opportunity', 'Opportunities')], column);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(line()).not.toBeNull());
    const aside = screen.getByTestId('column');
    fireEvent.click(line()!.querySelector('[data-related-empty-fold-expand]')!);
    expect(line()).toBeNull();
    stepTo('c2');
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(6));
    await waitFor(() => expect(line()).not.toBeNull());
    expect(screen.getByTestId('column')).toBe(aside);
    expect(shownPanels()).toEqual(['Tasks']);
    expect(line()!.textContent!.replace(/\s+/g, ' ')).toBe('2 more empty lists·Quotes·Opportunities·Expand');
  });

  it('a column whose panels are all empty folds them too', async () => {
    const { ds } = mount([panel('task', 'Tasks'), panel('quote', 'Quotes')], {});
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(line()).not.toBeNull());
    expect(shownPanels()).toEqual([]);
    expect(line()!.textContent!.replace(/\s+/g, ' ')).toBe('2 more empty lists·Tasks·Quotes·Expand');
  });
});
