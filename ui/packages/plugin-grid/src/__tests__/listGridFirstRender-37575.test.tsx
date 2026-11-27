/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37575 — a list page's grid draws its rows once before they
 * first paint.
 *
 * On a list page's first load three state writes each drew the whole table
 * again between its rows' first render and their first paint:
 *
 * - the grid's root element was set only once the rows drew, so the rows drew
 *   first with row-end controls, then the list page scope answered and they
 *   drew again without them (and the table's right-edge shadow with them);
 * - the inline-action fold held its host element in state, so mounting the
 *   host drew the grid again;
 * - the record verdicts were published as a new (empty) map on every read,
 *   though nothing was answered yet, so the grid drew again for nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, renderHook, screen, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { useListPageScope } from '../listPageScope';
import { useInlineRowActionFold } from '../objectGridInlineActionFold';
import { __clearRecordCrudVerdictCache, useRecordCrudVerdicts } from '../hooks/useRecordCrudVerdicts';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();
beforeEach(() => __clearRecordCrudVerdictCache());

const apiFetch = async (): Promise<Response> =>
  ({ ok: true, status: 200, json: async () => ({ allowed: true, layers: [] }) }) as unknown as Response;

const SCHEMA: any = {
  type: 'object-grid',
  objectName: 'test_object',
  columns: [
    { field: 'name', label: 'Name' },
    { field: 'amount', label: 'Amount', type: 'number' },
  ],
  data: {
    provider: 'value',
    items: [
      { id: '1', name: 'Alice', amount: 100 },
      { id: '2', name: 'Bob', amount: 200 },
    ],
  },
  rowActionDefs: [{ name: 'clone', label: 'Clone' }],
};

/** A page bar that registers its page column as a list page scope, as the Console's do. */
const PageBar: React.FC = () => {
  const [scope, setScope] = React.useState<HTMLElement | null>(null);
  useListPageScope(scope);
  return <div ref={(el) => setScope(el?.parentElement ?? null)} data-testid="page-bar" />;
};

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <SchemaRendererProvider dataSource={undefined} apiFetch={apiFetch}>
    <ActionProvider>{children}</ActionProvider>
  </SchemaRendererProvider>
);

describe('objectstack#37575 — a list page grid draws its rows once before they paint', () => {
  it('a row-end control never enters the DOM of a list page grid, not even for its first render', async () => {
    // Read off the nodes added AND removed: a control drawn by one commit and
    // taken away by the next, before this observer runs, shows as removed.
    const CONTROL = '[data-testid="row-action-trigger"], th[data-column-key="_actions"]';
    const seen: string[] = [];
    const note = (node: Node) => {
      if (node instanceof HTMLElement && (node.matches(CONTROL) || node.querySelector(CONTROL))) seen.push(node.tagName);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(note);
        record.removedNodes.forEach(note);
      }
    });
    // The page bar is up before the grid mounts, as on a Console list page,
    // where it draws while the rows are still being read.
    const page = (withGrid: boolean) => (
      <Providers>
        <div>
          <PageBar />
          {withGrid && <ObjectGrid schema={SCHEMA} onEdit={() => {}} onDelete={() => {}} />}
        </div>
      </Providers>
    );
    const { rerender } = render(page(false));
    observer.observe(document.body, { childList: true, subtree: true });
    rerender(page(true));
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    observer.disconnect();
    expect(seen).toEqual([]);
  });

  it('attaching the inline-action fold to its host does not render the grid again', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useInlineRowActionFold([], '[]');
    });
    const before = renders;
    const host = document.createElement('div');
    act(() => result.current.hostRef(host));
    act(() => result.current.hostRef(null));
    expect(renders).toBe(before);
  });

  it('record verdicts read again with nothing answered keep the same lookup', () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useRecordCrudVerdicts({ objectName: 'test_object', recordIds: ids, update: true }),
      { wrapper: Providers, initialProps: { ids: [] as string[] } },
    );
    const first = result.current;
    rerender({ ids: ['1', '2'] });
    expect(result.current).toBe(first);
    expect(result.current('1', 'update')).toBeUndefined();
  });
});
