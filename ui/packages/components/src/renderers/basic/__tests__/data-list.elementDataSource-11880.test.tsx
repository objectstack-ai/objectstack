/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11880 (the repeater half) — `element:repeater` reads the node-level
 * `dataSource` binding (ruling objectstack-ai/objectstack#11509, A-narrow,
 * objectui first; triage on objectui#11880: direction A). Since objectui#12085
 * the registration publishes the binding alone, and since objectui#12345 the
 * renderer reads it alone: `@objectstack/spec` 18 retired the row's flat
 * `object`, `filter`, `sort` and `limit`, the types mirror refuses them
 * (`packages/types`, `element-repeater-data-source-11880.test.ts`), and the one
 * in-repo producer that still wrote them (the console's `DevLists` dev route)
 * writes the binding now. No grace window and no second spelling.
 *
 * ## The defect 11880 fixed
 *
 * The repeater was the one element that read no binding: a repeater bound only
 * through `dataSource` issued no query and showed "No records" — the trap the
 * ruling's sub-question 4 names, indistinguishable from an object with no rows.
 *
 * ## What is pinned here
 *
 *   - a binding-only repeater lists its rows, with the binding's query;
 *   - the flat keys are not read: alone (in either config bag) they issue no
 *     read, and beside a binding they change nothing about the read it issues;
 *   - the binding and its saved view compose as every bound block's do: the
 *     binding's own `sort` and usable `limit` win, the view's are the baseline,
 *     the two filters AND-combine (objectui#10016 for the refused cap).
 *
 * Rendered through the real `SchemaRenderer` and this package's registration,
 * with a recording adapter, and asserted at the read the repeater issues.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, SchemaRenderer, notifyDataChanged } from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { SchemaElement } from '@object-ui/sdui-parser';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 60)));

const ACTIVE = [{ field: 'status', operator: 'equals', value: 'active' }];
const MINE = [{ field: 'owner', operator: 'equals', value: 'u1' }];
const BY_NAME = [{ field: 'name', order: 'asc' }];
const BY_DATE = [{ field: 'created', order: 'desc' }];

const HOT_VIEW = {
  name: 'hot',
  label: 'Hot',
  filter: [{ field: 'rating', operator: 'equals', value: 'hot' }],
  sort: [{ field: 'rating', order: 'desc' }],
  pagination: { pageSize: 7 },
};

function makeAdapter(rows: Array<Record<string, unknown>> = [{ id: 'r1', name: 'Ada' }]) {
  return {
    find: vi.fn(async (..._args: unknown[]) => ({ data: rows, total: rows.length })),
    getObjectSchema: vi.fn(async () => ({ name: 'contact', fields: {}, listViews: { hot: HOT_VIEW } })),
  };
}

function mount(fields: Record<string, unknown>, adapter = makeAdapter()) {
  render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer schema={{ type: 'element:repeater', id: 'rep', ...fields } as never} />
    </AdapterCtx.Provider>,
  );
  return adapter;
}

/** The object and query of the first read the repeater issued. */
const firstRead = (adapter: ReturnType<typeof makeAdapter>) => {
  const [object, query] = adapter.find.mock.calls[0] as [string, Record<string, unknown>];
  return { object, query };
};

describe('element:repeater reads the node-level `dataSource` (objectui#11880)', () => {
  it('SUBJECT: a repeater bound only through `dataSource` lists its rows', async () => {
    const adapter = mount({
      dataSource: { object: 'contact', filter: ACTIVE, sort: BY_NAME, limit: 5 },
      properties: { titleField: 'name' },
    });
    await waitFor(() => expect(screen.getByTestId('repeater')).toHaveTextContent('Ada'));
    expect(firstRead(adapter)).toEqual({
      object: 'contact',
      query: { $filter: ACTIVE, $orderby: BY_NAME, $top: 5 },
    });
  });

  it('a binding\'s own sort and cap win over its saved view\'s, and the two filters AND-combine', async () => {
    const adapter = mount({ dataSource: { object: 'contact', view: 'hot', filter: MINE, sort: BY_DATE, limit: 3 } });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const { query } = firstRead(adapter);
    expect(query.$orderby).toEqual(BY_DATE);
    expect(query.$top).toBe(3);
    const filter = JSON.stringify(query.$filter);
    expect(filter).toContain('rating');
    expect(filter).toContain('owner');
  });

  it('control: with no sort or cap of the binding\'s own, the saved view supplies them', async () => {
    const adapter = mount({ dataSource: { object: 'contact', view: 'hot' } });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    const { query } = firstRead(adapter);
    expect(query.$orderby).toEqual(HOT_VIEW.sort);
    expect(query.$top).toBe(7);
    expect(query.$filter).toEqual(HOT_VIEW.filter);
  });

  it('a cap the contract refuses is not authored: a binding `limit: 0` yields to the view\'s cap, and alone sends none', async () => {
    const viewed = mount({ dataSource: { object: 'contact', view: 'hot', limit: 0 } });
    await waitFor(() => expect(viewed.find).toHaveBeenCalled());
    expect(firstRead(viewed).query.$top).toBe(7);
    cleanup();
    const bare = mount({ dataSource: { object: 'lead', limit: 0 } });
    await waitFor(() => expect(bare.find).toHaveBeenCalled());
    expect(firstRead(bare).query).not.toHaveProperty('$top');
  });

  it('an unresolvable `view` reports, and the list issues no read', async () => {
    const adapter = mount({ dataSource: { object: 'contact', view: 'nope' } });
    await waitFor(() => expect(screen.getByTestId('repeater-datasource-error')).toBeInTheDocument());
    await settle();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('re-reads on the bus for the BOUND object, not for a flat one beside it', async () => {
    const adapter = mount({ dataSource: { object: 'lead' }, properties: { object: 'contact', titleField: 'name' } });
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: 'contact' });
    });
    await settle();
    expect(adapter.find, 'a write to the flat object re-read the bound list').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'lead' });
    });
    await settle();
    expect(adapter.find).toHaveBeenCalledTimes(2);
    expect(adapter.find.mock.calls[1]![0]).toBe('lead');
  });
});

/**
 * objectui#12345 — the four keys `@objectstack/spec` 18 retired from the row
 * are not read, in either config bag `readProps` merges (`properties`, and the
 * legacy `props` alias). They read as the binding's fallback before.
 */
describe('element:repeater does not read the retired flat query keys (objectui#12345)', () => {
  const FLAT = { object: 'contact', filter: MINE, sort: BY_DATE, limit: 3 };

  it.each([
    ['properties', { properties: { ...FLAT, titleField: 'name' } }],
    ['props', { props: { ...FLAT, titleField: 'name' } }],
  ])('a node carrying only the flat keys (in `%s`) issues no read and shows the empty state', async (_bag, node) => {
    const adapter = mount(node);
    await waitFor(() => expect(screen.getByText('No data')).toBeInTheDocument());
    await settle();
    expect(adapter.find, 'the flat `object` was read as the query object').not.toHaveBeenCalled();
  });

  it('beside a binding, the flat keys change nothing: the read is the binding\'s alone', async () => {
    const adapter = mount({
      dataSource: { object: 'lead', filter: ACTIVE, sort: BY_NAME, limit: 5 },
      properties: { ...FLAT, titleField: 'name' },
    });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(firstRead(adapter)).toEqual({ object: 'lead', query: { $filter: ACTIVE, $orderby: BY_NAME, $top: 5 } });
  });

  it('a binding with no query keys of its own does not borrow the flat ones', async () => {
    const adapter = mount({ dataSource: { object: 'lead' }, properties: { ...FLAT, titleField: 'name' } });
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    expect(firstRead(adapter)).toEqual({ object: 'lead', query: {} });
  });

  it('a binding that names no object issues no read, whatever flat `object` sits beside it', async () => {
    const adapter = mount({ dataSource: { object: '' }, properties: { ...FLAT, titleField: 'name' } });
    await waitFor(() => expect(screen.getByText('No data')).toBeInTheDocument());
    await settle();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('control: the same mount bound through `dataSource` does read, so each silence above is the flat key\'s', async () => {
    const adapter = mount({ dataSource: { object: 'contact' }, properties: { titleField: 'name' } });
    await waitFor(() => expect(screen.getByTestId('repeater')).toHaveTextContent('Ada'));
    expect(adapter.find).toHaveBeenCalledTimes(1);
  });
});

describe('element:repeater publishes the binding as its one query door (objectui#11880, objectui#12085)', () => {
  const inputs = () => (ComponentRegistry.getConfig('element:repeater')?.inputs ?? []) as Array<{ name: string; required?: boolean }>;

  /** The page validator's verdict on one node, over the manifest the registry publishes. */
  const diagnose = (node: Record<string, unknown>) =>
    validateTree(
      node as unknown as SchemaElement,
      manifestFromConfigs(ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0]),
    ).diagnostics.map((diagnostic) => ({ severity: diagnostic.severity, code: diagnostic.code }));

  it('publishes the injected `dataSource`, and none of the flat query keys `@objectstack/spec` retires', () => {
    const names = inputs().map((input) => input.name);
    expect(names).toContain('dataSource');
    // The spec retired all four and the renderer reads none of them (pinned
    // above, objectui#12345), so none of them is published.
    for (const key of ['object', 'filter', 'sort', 'limit']) expect(names, key).not.toContain(key);
  });

  it('requires no input: the object is named by `dataSource.object`', () => {
    expect(inputs().filter((input) => input.required).map((input) => input.name)).toEqual([]);
  });

  it('the html tier accepts a repeater bound through `dataSource` alone (it raised `missing-required-prop` before)', () => {
    expect(diagnose({ type: 'element:repeater', dataSource: { object: 'contact', limit: 5 }, titleField: 'name' })).toEqual([]);
  });

  it('the html tier reports each retired flat query key as a prop the repeater does not have', () => {
    const bound = { type: 'element:repeater', dataSource: { object: 'contact' } };
    const flat: Record<string, unknown> = { object: 'contact', filter: ACTIVE, sort: BY_NAME, limit: 5 };
    for (const [key, value] of Object.entries(flat)) {
      expect(diagnose({ ...bound, [key]: value }), key).toEqual([{ severity: 'warning', code: 'unknown-prop' }]);
    }
    // Control: the same node without the flat key draws nothing, so each
    // report above is that key's.
    expect(diagnose(bound)).toEqual([]);
  });
});
