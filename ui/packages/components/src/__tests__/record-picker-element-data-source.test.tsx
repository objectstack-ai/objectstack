/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `element:record_picker` honours `dataSource.view` (objectstack#6953).
 *
 * This block DID read the spec's per-element binding — `object`, `filter`,
 * `sort`, `limit` — and dropped exactly one key: `view`. So
 * `dataSource: { object: 'account', view: 'hot' }`, the spec's own example,
 * built a picker over EVERY account instead of the rows the saved view selects.
 *
 * That symptom is quieter than the one objectstack#5576 fixed on `list-view`:
 * nothing throws and nothing renders an error — the option list is simply WIDER
 * than what was authored, and a picker whose list is too wide is a picker that
 * lets a user select a record the page said was out of scope. It is the failure
 * class an AI-authored page hides best, which is why the not-found case below
 * reports instead of falling back.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers `element:record_picker` at module scope (not in a hook) — the
// objectui#3010 rule.
import '../renderers';

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot accounts',
  columns: ['name', 'rating'],
  filter: [['rating', '=', 'hot']],
  sort: [{ field: 'name', order: 'desc' }],
  pagination: { pageSize: 7 },
};

function makeAdapter(listViews: Record<string, unknown> = { hot: HOT_VIEW }) {
  return {
    find: vi.fn().mockResolvedValue({
      data: [
        { id: 'a1', name: 'Acme', rating: 'hot' },
        { id: 'a2', name: 'Zephyr', rating: 'hot' },
      ],
    }),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'account', fields: {}, listViews }),
  };
}

const renderPicker = (schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) =>
  render(
    <AdapterCtx.Provider value={adapter as any}>
      <SchemaRenderer schema={{ type: 'element:record_picker', id: 'picker', ...schema } as any} />
    </AdapterCtx.Provider>,
  );

const firstQuery = (adapter: ReturnType<typeof makeAdapter>) =>
  adapter.find.mock.calls[0][1] as any;

describe('element:record_picker — dataSource.view (objectstack#6953)', () => {
  it('narrows the option list to the saved view’s filter, sort and cap', async () => {
    const adapter = makeAdapter();
    renderPicker({ dataSource: { object: 'account', view: 'hot' } }, adapter);

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    const query = firstQuery(adapter);
    // The dropped key, now applied: before this, all three were absent and the
    // picker offered every record of the object.
    expect(query.$filter).toEqual([['rating', '=', 'hot']]);
    expect(query.$orderby).toEqual([{ field: 'name', order: 'desc' }]);
    expect(query.$top).toBe(7);
  });

  it('AND-combines the binding’s own filter with the view’s', async () => {
    const adapter = makeAdapter();
    renderPicker(
      { dataSource: { object: 'account', view: 'hot', filter: [['amount', '>', 100]] } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // "Additional filter criteria" (spec): the binding narrows the view, never
    // widens it — a mistyped per-element filter cannot expose rows the view
    // excluded.
    const json = JSON.stringify(firstQuery(adapter).$filter);
    expect(json).toContain('rating');
    expect(json).toContain('amount');
  });

  it('lets explicit binding keys override the view’s sort and cap', async () => {
    const adapter = makeAdapter();
    renderPicker(
      { dataSource: { object: 'account', view: 'hot', sort: [{ field: 'amount', order: 'asc' }], limit: 3 } },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const query = firstQuery(adapter);
    expect(query.$orderby).toEqual([{ field: 'amount', order: 'asc' }]);
    expect(query.$top).toBe(3);
  });

  it('reports an unresolvable `view` instead of offering every record', async () => {
    const adapter = makeAdapter();
    const { container } = renderPicker({ dataSource: { object: 'account', view: 'nope' } }, adapter);

    await waitFor(() =>
      expect(container.querySelector('[data-testid="record-picker-datasource-error"]')).not.toBeNull(),
    );
    // The whole point: no query at all rather than an unfiltered one.
    expect(adapter.find).not.toHaveBeenCalled();
    expect(container.textContent).toContain('hot');
  });

  it('leaves a picker with NO view exactly as it was', async () => {
    // The other direction of the single-variable reproduction: the four keys
    // this block already read must behave identically.
    const adapter = makeAdapter();
    renderPicker(
      {
        dataSource: {
          object: 'account',
          filter: [['owner', '=', 'me']],
          sort: [{ field: 'name', order: 'asc' }],
          limit: 12,
        },
      },
      adapter,
    );

    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const query = firstQuery(adapter);
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    expect(query.$filter).toEqual([['owner', '=', 'me']]);
    expect(query.$orderby).toEqual([{ field: 'name', order: 'asc' }]);
    expect(query.$top).toBe(12);
    // No view named ⇒ nothing about saved views is fetched.
    expect(adapter.getObjectSchema).not.toHaveBeenCalled();
  });

  // objectui#11880 — the binding is the picker's ONE source. Until then a flat
  // `properties.object` / `filter` / `sort` / `limit` stood in for whichever
  // binding member was absent (`composed?.x ?? props.x`); objectstack#11509
  // retires those keys, and the picker reads none of them.
  it('a flat `properties.object` alone binds nothing: no query, and the control is disabled', async () => {
    const adapter = makeAdapter();
    const { container } = renderPicker({ properties: { object: 'account' } }, adapter);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adapter.find).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="record-picker-trigger"]')).toBeDisabled();
  });

  it('beside a binding, the flat `filter` / `sort` / `limit` are not read', async () => {
    const adapter = makeAdapter();
    renderPicker(
      {
        dataSource: { object: 'account' },
        properties: {
          object: 'lead',
          filter: [{ field: 'owner', operator: 'equals', value: 'me' }],
          sort: [{ field: 'name', order: 'asc' }],
          limit: 12,
        },
      },
      adapter,
    );
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(adapter.find.mock.calls[0][0]).toBe('account');
    // Only the renderer's own default cap: no flat key reaches the query.
    expect(firstQuery(adapter)).toEqual({ $top: 50 });
  });
});
