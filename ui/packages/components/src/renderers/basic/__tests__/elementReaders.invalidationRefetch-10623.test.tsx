/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10623 — `element:number` and `element:repeater` re-read when the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`) reports a
 * write to the object they read.
 *
 * Before this card neither effect named a nonce, so a write declared on the bus
 * (a page action over raw HTTP, a flow, a server action) left the number and
 * the list stale until something remounted the page. Each effect now names the
 * `useDataInvalidation` nonce for the object in its `properties.object` (the
 * objectui#10494 shape).
 *
 * Rendered through the real `SchemaRenderer` and this package's own
 * registrations, under the `AdapterCtx` provider these two read their adapter
 * from (without it they issue no read at all). The bare `useDataInvalidation`
 * reader mounted beside each block is the positive control: it proves the
 * event reached subscribers in this harness.
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup, screen, waitFor } from '@testing-library/react';
import { AdapterCtx, SchemaRenderer, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));

function makeAdapter() {
  let rows = [{ id: 'r1', name: 'Ada' }];
  return {
    addRow(row: { id: string; name: string }) {
      rows = [...rows, row];
    },
    find: vi.fn(async () => ({ data: rows, total: rows.length })),
    aggregate: vi.fn(async () => [{ count: rows.length }]),
  };
}

/** The positive control: a bare reader of the same object, beside the block. */
function BusControl() {
  const nonce = useDataInvalidation('contact');
  return <span data-testid="bus-control">{nonce}</span>;
}

function mount(schema: Record<string, unknown>, adapter: ReturnType<typeof makeAdapter>) {
  render(
    <AdapterCtx.Provider value={adapter as never}>
      <BusControl />
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>,
  );
}

// Both read their object from the node-level `dataSource` binding
// (objectui#11880; the repeater's only query source since objectui#12345).
const NUMBER = { type: 'element:number', id: 'n', dataSource: { object: 'contact' }, properties: { aggregate: 'count' } };
const REPEATER = { type: 'element:repeater', id: 'rep', dataSource: { object: 'contact' }, properties: { fields: ['name'] } };

const cases = [
  {
    block: 'element:number',
    schema: NUMBER,
    unbound: { type: 'element:number', id: 'n', properties: { aggregate: 'count' } },
    read: (a: ReturnType<typeof makeAdapter>) => a.aggregate,
  },
  {
    block: 'element:repeater',
    schema: REPEATER,
    unbound: { type: 'element:repeater', id: 'rep', properties: { fields: ['name'] } },
    read: (a: ReturnType<typeof makeAdapter>) => a.find,
  },
] as const;

describe.each(cases)('$block re-reads on the data-invalidation bus (objectui#10623)', ({ schema, unbound, read }) => {
  it('an unscoped change (objectName "*") re-runs its read once', async () => {
    const adapter = makeAdapter();
    mount(schema, adapter);
    await waitFor(() => expect(read(adapter)).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent, 'control: the event never reached a subscriber').toBe('1');
    expect(read(adapter), 'the block never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
  });

  it('a change to its own object re-runs its read once; another object does not', async () => {
    const adapter = makeAdapter();
    mount(schema, adapter);
    await waitFor(() => expect(read(adapter)).toHaveBeenCalledTimes(1));
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: 'some_other_object' });
    });
    await settle();
    expect(read(adapter), 'a change to another object re-read this block').toHaveBeenCalledTimes(1);

    await act(async () => {
      notifyDataChanged({ objectName: 'contact', recordId: 'r1' });
    });
    await settle();
    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(read(adapter)).toHaveBeenCalledTimes(2);
  });

  it('a block with no object binding reads nothing on an invalidation', async () => {
    const adapter = makeAdapter();
    mount(unbound, adapter);
    await settle();

    await act(async () => {
      notifyDataChanged({ objectName: '*' });
    });
    await settle();

    expect(screen.getByTestId('bus-control').textContent).toBe('1');
    expect(adapter.find).not.toHaveBeenCalled();
    expect(adapter.aggregate).not.toHaveBeenCalled();
  });
});

describe('the re-read shows the new data (objectui#10623)', () => {
  it('element:number shows the new count and element:repeater the new row', async () => {
    const adapter = makeAdapter();
    render(
      <AdapterCtx.Provider value={adapter as never}>
        <SchemaRenderer schema={NUMBER as never} />
        <SchemaRenderer schema={REPEATER as never} />
      </AdapterCtx.Provider>,
    );
    await waitFor(() => expect(screen.getByText('Ada')).toBeTruthy());

    adapter.addRow({ id: 'r2', name: 'Grace' });
    await act(async () => {
      notifyDataChanged({ objectName: 'contact' });
    });

    await waitFor(() => expect(screen.getByText('Grace')).toBeTruthy());
    expect(screen.getByText('2')).toBeTruthy();
  });
});
