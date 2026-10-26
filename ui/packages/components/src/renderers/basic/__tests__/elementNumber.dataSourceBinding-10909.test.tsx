/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:number.dataSource` — the metric reads its object from the spec's
 * per-element binding (objectui#10909).
 *
 * `PageComponentSchema.dataSource` is the spec's per-element data binding, and
 * the spec lint gate (`validateComponentProps`) waives a missing
 * `properties.object` when `dataSource.object` names one, on the stated ground
 * that objectui's element renderers read the binding FIRST
 * (`ds.object ?? props.object`). `ElementNumberRenderer` read only
 * `properties.object`, so `{ dataSource: { object }, properties: { aggregate } }`
 * — which the spec lint gate accepts — issued no query at all and painted the
 * empty dash, with nothing to tell the author why.
 *
 * The renderer now resolves the binding the way its element twin
 * `element:record_picker` does, through `useElementDataSource`. This file pins
 * the member set it READS and the members it deliberately does not:
 *
 *   | member   | read? | how                                                        |
 *   |----------|-------|------------------------------------------------------------|
 *   | `object` | yes   | `dataSource.object` ONLY — ONE value for the fetch guard,  |
 *   |          |       | `aggregate` / `find` and the bus key; no object at all     |
 *   |          |       | while a named view is unresolved (objectui#11880)          |
 *   | `view`   | yes   | a saved view's `filter` scopes the aggregate; one that     |
 *   |          |       | cannot be resolved REPORTS and aggregates nothing          |
 *   | `filter` | yes   | view AND binding filter, lowered; a refused one REPORTS    |
 *   |          |       | and aggregates nothing. `properties.filter` is not read    |
 *   |          |       | (objectui#11880)                                           |
 *   | `sort`   | no    | an aggregate has no ordering — never reaches the call      |
 *   | `limit`  | no    | an aggregate has no row cap — a capped count is a wrong    |
 *   |          |       | number, so neither the binding's nor a view's cap reaches  |
 *   |          |       | the call                                                   |
 *
 * Since objectui#11880 (objectstack#11509, ruled A-narrow) the binding is the
 * metric's ONE source: the flat `properties.object` / `filter` are read by
 * nothing, and a metric with no binding shows its no-object state.
 * No record-context binding is added here — that is objectui#7297's, and the
 * filter shape note is objectui#8945's.
 *
 * Driven through the real `SchemaRenderer` and this package's own
 * registrations, under the `AdapterCtx` provider the renderer reads its adapter
 * from, with `aggregate` / `find` spies.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { AdapterCtx, SchemaRenderer, notifyDataChanged } from '@object-ui/react';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

/** A saved view of `contact` — its filter is the observable proof the view resolved. */
const HOT_FILTER = [{ field: 'status', operator: 'equals', value: 'hot' }];
const HOT_VIEW = {
  name: 'hot',
  filter: HOT_FILTER,
  // Neither of these may reach an aggregate: see the whole-bag rows below.
  sort: [{ field: 'name', order: 'asc' }],
  pagination: { pageSize: 5 },
  columns: ['name'],
};

const BINDING_FILTER = [{ field: 'owner', operator: 'equals', value: 'ada' }];
const PROPS_FILTER = [{ field: 'region', operator: 'equals', value: 'emea' }];
/**
 * A rule the converter refuses: an ARRAY comparand on single-valued `equals`
 * (objectui#8557). Written as the binding's own `filter`, it is the lowering's
 * refusal, not the view's.
 */
const REFUSED_FILTER = [{ field: 'tags', operator: 'equals', value: ['a'] }];

/**
 * The wire shapes, written out rather than computed with the renderer's own
 * helpers, so a pin cannot agree with an implementation by construction. The
 * binding's filter (AND-combined with its view's) is lowered to the ObjectQL
 * AST before it reaches the adapter.
 */
const HOT_NODE = [['status', 'equals', 'hot']];
const BINDING_NODE = [['owner', 'equals', 'ada']];

/** An adapter that CAN aggregate — the primary path. */
function makeAdapter() {
  const rows = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
  return {
    aggregate: vi.fn(async (..._args: unknown[]) => [{ count: 7 }]),
    find: vi.fn(async (..._args: unknown[]) => ({ data: rows, total: rows.length })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {}, listViews: { hot: HOT_VIEW } })),
  };
}

/** An adapter that cannot — `find()` is the only way to a number. */
function makeFindOnlyAdapter() {
  const { aggregate: _aggregate, ...rest } = makeAdapter();
  return rest;
}

function mount(schema: Record<string, unknown>, adapter: object) {
  return render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>,
  );
}

/** The spec-valid `dataSource` form the card names. */
const BOUND = {
  type: 'element:number',
  id: 'bound',
  dataSource: { object: 'contact' },
  properties: { aggregate: 'count' },
};

/** The flat `properties` form — read by nothing since objectui#11880. */
const FLAT = {
  type: 'element:number',
  id: 'flat',
  properties: { object: 'contact', aggregate: 'count' },
};

/** The options bag a count over `contact` sends, filter aside. */
const countBag = (filter: unknown) => ({ field: undefined, function: 'count', groupBy: '_all', filter });

describe('element:number reads its object from `dataSource.object` (objectui#10909)', () => {
  it('the dataSource form calls aggregate for the bound object and paints the value', async () => {
    const adapter = makeAdapter();
    mount(BOUND, adapter);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    expect(adapter.aggregate).toHaveBeenCalledWith('contact', countBag(undefined));
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
    expect(screen.queryByText('—')).toBeNull();
  });

  it('a flat properties.object beside the binding is not read: only the bound object is aggregated', async () => {
    const adapter = makeAdapter();
    mount({ ...BOUND, properties: { object: 'account', aggregate: 'count' } }, adapter);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    await settle();
    expect(adapter.aggregate.mock.calls.map((call) => call[0])).toEqual(['contact']);
  });

  it('the flat properties form alone binds nothing: the no-object state, and no read (objectui#11880)', async () => {
    const adapter = makeAdapter();
    mount(FLAT, adapter);
    expect(await screen.findByTestId('element-number-no-object')).toBeTruthy();
    await settle();
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
    // No binding means no saved-view read either.
    expect(adapter.getObjectSchema).not.toHaveBeenCalled();
  });

  it('the find() fallback reads the bound object when the adapter cannot aggregate', async () => {
    const adapter = makeFindOnlyAdapter();
    mount(BOUND, adapter);
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    expect(adapter.find).toHaveBeenCalledWith('contact', undefined);
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
  });

  it('a binding that names no object supplies nothing: the no-object state, whatever the flat object says', async () => {
    // The spec gate's own reading of "supplies": an empty or non-string
    // `dataSource.object` names nothing, and the flat key is not read.
    const adapter = makeAdapter();
    mount({ ...FLAT, dataSource: { object: '' } }, adapter);
    expect(await screen.findByTestId('element-number-no-object')).toBeTruthy();
    await settle();
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });
});

describe('element:number re-reads the dataSource form on the data-invalidation bus (objectui#10909)', () => {
  it('one bus event re-reads it, keyed on the resolved object', async () => {
    const adapter = makeAdapter();
    mount(BOUND, adapter);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(adapter.aggregate, 'a change to another object re-read the metric').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'contact' });
    });
    await settle();
    expect(adapter.aggregate, 'the bound object changed and the metric never re-read').toHaveBeenCalledTimes(2);
  });

  it('the key is the binding, not a flat object beside it', async () => {
    const adapter = makeAdapter();
    mount({ ...BOUND, properties: { object: 'account', aggregate: 'count' } }, adapter);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: 'account' });
    });
    await settle();
    expect(adapter.aggregate, 'a change to the unread flat object re-read the metric').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'contact' });
    });
    await settle();
    expect(adapter.aggregate).toHaveBeenCalledTimes(2);
    expect(adapter.aggregate.mock.calls.map((call) => call[0])).toEqual(['contact', 'contact']);
  });
});

describe('element:number — the `dataSource` members it reads, and the ones it does not (objectui#10909)', () => {
  it('filter: the binding filter scopes the aggregate', async () => {
    const adapter = makeAdapter();
    mount({ ...BOUND, dataSource: { object: 'contact', filter: BINDING_FILTER } }, adapter);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    expect(adapter.aggregate).toHaveBeenCalledWith('contact', countBag(BINDING_NODE));
  });

  it('filter: properties.filter is not read — the binding filter alone reaches the aggregate, with no AND (objectui#11880)', async () => {
    const both = makeAdapter();
    mount(
      {
        ...BOUND,
        dataSource: { object: 'contact', filter: BINDING_FILTER },
        properties: { aggregate: 'count', filter: PROPS_FILTER },
      },
      both,
    );
    await waitFor(() => expect(both.aggregate).toHaveBeenCalledTimes(1));
    expect(both.aggregate).toHaveBeenCalledWith('contact', countBag(BINDING_NODE));
    cleanup();

    // A binding that carries no filter scopes nothing: the node's own is not read.
    const flatOnly = makeAdapter();
    mount({ ...BOUND, properties: { aggregate: 'count', filter: PROPS_FILTER } }, flatOnly);
    await waitFor(() => expect(flatOnly.aggregate).toHaveBeenCalledTimes(1));
    expect(flatOnly.aggregate).toHaveBeenCalledWith('contact', countBag(undefined));
  });

  it("filter: a named view's filter scopes the aggregate, and properties.filter beside it is not read", async () => {
    const adapter = makeAdapter();
    mount(
      {
        ...BOUND,
        dataSource: { object: 'contact', view: 'hot' },
        properties: { aggregate: 'count', filter: PROPS_FILTER },
      },
      adapter,
    );
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    expect(adapter.aggregate).toHaveBeenCalledWith('contact', countBag(HOT_NODE));
  });

  it('filter: a binding filter the converter refuses reports on the error panel and aggregates nothing', async () => {
    const adapter = makeAdapter();
    mount(
      {
        ...BOUND,
        dataSource: { object: 'contact', filter: REFUSED_FILTER },
        properties: { aggregate: 'count' },
      },
      adapter,
    );
    const panel = await screen.findByTestId('element-number-datasource-error');
    // The refusal's own subject, so the author is told which rule to fix.
    expect(panel.textContent).toContain('tags');
    await settle();
    // Refused, not dropped: no count over a filter that lost a source.
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it("view: a named saved view's filter scopes the aggregate", async () => {
    const adapter = makeAdapter();
    mount({ ...BOUND, dataSource: { object: 'contact', view: 'hot' } }, adapter);
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    expect(adapter.getObjectSchema).toHaveBeenCalledWith('contact');
    expect(adapter.aggregate).toHaveBeenCalledWith('contact', countBag(HOT_NODE));
  });

  it('view: one that cannot be resolved reports and aggregates nothing', async () => {
    const adapter = makeAdapter();
    mount({ ...BOUND, dataSource: { object: 'contact', view: 'no_such_view' } }, adapter);
    await waitFor(() => expect(screen.getByTestId('element-number-datasource-error')).toBeTruthy());
    await settle();
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('view: an unresolvable one does not fall back to properties.object — no object while it is unresolved', async () => {
    // The `unresolved ? undefined :` half of the resolution line, and since
    // objectui#11880 the flat object is not read at all: a count over it
    // WITHOUT the view's filter is the wider count the view was written to
    // prevent.
    const adapter = makeAdapter();
    mount(
      {
        ...BOUND,
        dataSource: { object: 'contact', view: 'no_such_view' },
        properties: { object: 'contact', aggregate: 'count' },
      },
      adapter,
    );
    await waitFor(() => expect(screen.getByTestId('element-number-datasource-error')).toBeTruthy());
    await settle();
    expect(adapter.aggregate).not.toHaveBeenCalled();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('sort and limit are not read: the options bag stays whole with a binding and a view carrying both', async () => {
    const adapter = makeAdapter();
    mount(
      {
        ...BOUND,
        dataSource: { object: 'contact', view: 'hot', sort: [{ field: 'name', order: 'desc' }], limit: 2 },
      },
      adapter,
    );
    await waitFor(() => expect(adapter.aggregate).toHaveBeenCalledTimes(1));
    const [object, bag] = adapter.aggregate.mock.calls[0] as [string, Record<string, unknown>];
    expect(object).toBe('contact');
    expect(Object.keys(bag).sort()).toEqual(['field', 'filter', 'function', 'groupBy']);
    expect(bag).toEqual(countBag(HOT_NODE));
  });

  it('limit is not read on the find() fallback either: a count is never capped', async () => {
    const adapter = makeFindOnlyAdapter();
    mount({ ...BOUND, dataSource: { object: 'contact', limit: 2 } }, adapter);
    await waitFor(() => expect(adapter.find).toHaveBeenCalledTimes(1));
    expect(adapter.find).toHaveBeenCalledWith('contact', undefined);
    await waitFor(() => expect(screen.getByText('3')).toBeTruthy());
  });
});

describe('element:number declares the `dataSource` binding it reads (objectui#10909)', () => {
  const inputs = () => ComponentRegistry.getMeta('element:number')?.inputs ?? [];

  it('the registration declares dataSource as an object binding, and publishes no flat `object` / `filter` (objectui#12085)', () => {
    const dataSource = inputs().find((input) => input.name === 'dataSource');
    expect(dataSource, 'element:number publishes no dataSource input').toBeTruthy();
    expect((dataSource as { binding?: string }).binding).toBe('object');
    // Nothing reads the flat pair (objectui#11880), and `@objectstack/spec`
    // retires both as tombstones (objectstack#11509), so neither is offered.
    const names = inputs().map((input) => input.name);
    for (const key of ['object', 'filter']) expect(names, key).not.toContain(key);
  });

  it('the html tier reports a flat `object` / `filter` as props the metric does not have', () => {
    const manifest = manifestFromConfigs(
      ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
    );
    const bound = { type: 'element:number', dataSource: { object: 'contact' }, aggregate: 'count' };
    const verdict = (node: Record<string, unknown>) =>
      validateTree(node as never, manifest).diagnostics.map((d) => ({ severity: d.severity, code: d.code }));
    for (const [key, value] of Object.entries({ object: 'contact', filter: [{ field: 'status', operator: 'equals', value: 'hot' }] })) {
      expect(verdict({ ...bound, [key]: value }), key).toEqual([{ severity: 'warning', code: 'unknown-prop' }]);
    }
    // Control: the bound node alone draws nothing, so each report above is that key's.
    expect(verdict(bound)).toEqual([]);
  });

  it('the html tier accepts the dataSource form without a diagnostic', () => {
    const manifest = manifestFromConfigs(
      ComponentRegistry.getAllConfigs() as unknown as Parameters<typeof manifestFromConfigs>[0],
    );
    const { diagnostics } = validateTree(
      { type: 'element:number', dataSource: { object: 'contact' }, aggregate: 'count' } as never,
      manifest,
    );
    expect(diagnostics.map((d) => d.message)).toEqual([]);
    // Control: a block that does not read the binding is still told.
    const control = validateTree({ type: 'element:text', dataSource: { object: 'contact' } } as never, manifest);
    expect(control.diagnostics.map((d) => d.message)).toContain('<element:text> has no prop "dataSource"');
  });
});
