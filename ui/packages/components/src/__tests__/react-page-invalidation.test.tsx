/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A `kind:'react'` page's own reads re-run on the data-invalidation bus
 * (objectui#10887, member 3, ruled A).
 *
 * A react page reads data through the injected `useAdapter`, in an effect it
 * writes itself. The data blocks inside the page (`<ListView>` and the view
 * blocks) re-read on the bus on their own, but a page's own effect had nothing
 * to name: the scope injected no bus reader, so the effect re-ran only when the
 * host remounted the whole page (`PageView`'s `key={refreshKey}` after a page
 * action, which objectui#10519 removes). The scope now injects
 * `useDataInvalidation`, the same hook the blocks read, and the taught
 * pattern names its nonce in the effect's dependency list.
 *
 * Everything here is real: the page is compiled from source by
 * `@object-ui/react-runtime` inside the real `ReactKindPage` (dispatched by the
 * real `PageRenderer` for `type: 'home'`), and the events go through the real
 * bus, `notifyDataChanged` from `@object-ui/react`. Only the adapter is a
 * stand-in, so the reads can be counted.
 *
 * What is pinned:
 *   - one bus event on the page's object re-runs the page's read exactly once,
 *     the re-read rows reach the page, and the page keeps its own `useState`
 *     (a remount would reset the counter the user clicked);
 *   - the lit control: an event on another object does not re-run the read,
 *     while a bare `useDataInvalidation` reader mounted beside the page for
 *     that other object DOES move, so the event demonstrably reached the bus.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, AdapterCtx, notifyDataChanged, useDataInvalidation } from '@object-ui/react';
import type { PageDocumentNode } from '@object-ui/types';
// `ReactKindPage` loads the page runtime with `import('@object-ui/react-runtime')`.
// Importing the same specifier here bills its cold transform to this module's
// import phase instead of to a `findBy` window (AGENTS.md, flaky-test
// discipline: an unbounded module load inside a bounded wait).
import '@object-ui/react-runtime';
// Registers PageRenderer for `type:'home'`, which dispatches kind:'react'.
import '../renderers';

/** The Live data pattern the react-pages guide teaches, nonce included. */
const SOURCE = `
function Page() {
  const adapter = useAdapter();
  const changed = useDataInvalidation('showcase_project');
  const [rows, setRows] = React.useState([]);
  const [clicks, setClicks] = React.useState(0);

  React.useEffect(() => {
    adapter
      .find('showcase_project', { $top: 10 })
      .then((res) => setRows(res.data ?? []));
  }, [adapter, changed]);

  return (
    <div>
      <button data-testid="clicks" onClick={() => setClicks(clicks + 1)}>{clicks}</button>
      <ul data-testid="rows">{rows.map((r) => <li key={r._id}>{r.name}</li>)}</ul>
    </div>
  );
}`;

/** Module-scope so the schema identity is stable across host re-renders. */
const SCHEMA: PageDocumentNode = { type: 'home', kind: 'react', name: 'invalidation_page', label: 'Invalidation page', source: SOURCE };

let find: ReturnType<typeof vi.fn>;
let adapter: { find: typeof find };

beforeEach(() => {
  // Each answer names the read that produced it, so a re-read is visible on
  // screen and not only in the call count.
  find = vi.fn(async () => ({
    data: [{ _id: 'p1', name: `read ${find.mock.calls.length}` }],
    total: 1,
  }));
  adapter = { find };
});

/** A bare bus reader beside the page: the positive control for delivery. */
function BusProbe({ objectName }: { objectName: string }) {
  const nonce = useDataInvalidation(objectName);
  return <span data-testid={`probe-${objectName}`}>{nonce}</span>;
}

function Host() {
  return (
    <AdapterCtx.Provider value={adapter as unknown as React.ContextType<typeof AdapterCtx>}>
      <BusProbe objectName="showcase_invoice" />
      <SchemaRenderer schema={SCHEMA} />
    </AdapterCtx.Provider>
  );
}

/** Mount the page and settle on its first read. */
async function mountPage() {
  const utils = render(<Host />);
  // Settle on whichever the page reaches first: its list, or the page-level
  // error panel `ReactKindPage` renders when the source does not compile or
  // throws — which is what an identifier missing from the scope produces.
  await waitFor(() =>
    expect(utils.queryByTestId('rows') ?? utils.queryByText('React page error')).toBeTruthy(),
  );
  expect(
    utils.queryByText('React page error'),
    `the page failed against its injected scope: ${utils.container.textContent}`,
  ).toBeNull();
  await waitFor(() => expect(utils.getByTestId('rows').textContent).toBe('read 1'));
  expect(find).toHaveBeenCalledTimes(1);
  return utils;
}

describe("kind:'react' page scope — useDataInvalidation (objectui#10887)", () => {
  it('one bus event on the page object re-runs the page read once, in place, with no remount', async () => {
    const { getByTestId } = await mountPage();

    // State the user produced before the write: a remount would reset it.
    fireEvent.click(getByTestId('clicks'));
    expect(getByTestId('clicks').textContent).toBe('1');

    // A record-scoped write, the shape a save announces. The page's reader
    // names no record, so it is a list reader and every write to the object
    // stales it.
    act(() => {
      notifyDataChanged({ objectName: 'showcase_project', recordId: 'p1' });
    });

    await waitFor(() => expect(getByTestId('rows').textContent).toBe('read 2'));
    expect(find, 'the page read did not re-run exactly once after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(find).toHaveBeenLastCalledWith('showcase_project', { $top: 10 });
    // In place: the page's own state survived the re-read.
    expect(getByTestId('clicks').textContent).toBe('1');
  });

  it('lit control: an event on another object reaches the bus and does not re-run the page read', async () => {
    const { getByTestId } = await mountPage();
    expect(getByTestId('probe-showcase_invoice').textContent).toBe('0');

    await act(async () => {
      notifyDataChanged({ objectName: 'showcase_invoice' });
    });

    // Delivered: the bare reader for that object moved.
    await waitFor(() => expect(getByTestId('probe-showcase_invoice').textContent).toBe('1'));
    // Not for this page: its read did not re-run, and its rows are the first answer.
    expect(find).toHaveBeenCalledTimes(1);
    expect(getByTestId('rows').textContent).toBe('read 1');
  });
});
