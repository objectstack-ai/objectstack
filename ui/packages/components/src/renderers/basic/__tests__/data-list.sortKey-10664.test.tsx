/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10664 (folded from objectui#10665) — `element:repeater` re-reads
 * when its `sort` changes, and only then.
 *
 * The fetch effect lowers the sort onto `$orderby`, but its dependency
 * list named `filterKey` and no sort at all. A mounted repeater whose sort
 * changed (a bound sort control, a live designer preview) kept the old order
 * until the object, the filter, the limit or a data-invalidation event re-ran
 * the read. The sort is now keyed the way `filterKey` keys the filter: by
 * CONTENT, so a new array with the same entries is not a change. The sort is
 * the node-level `dataSource` binding's, the repeater's one query source
 * (objectui#12345).
 *
 * Both halves are pinned. The CONTROL (an equal sort in a fresh array) is green
 * before the fix and after it; it goes red for a fix that keys on the array's
 * identity instead of its content (AGENTS.md #10: a key is a primitive or a
 * structurally stable value).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

const BY_NAME_ASC = [{ field: 'name', order: 'asc' }];
const BY_NAME_DESC = [{ field: 'name', order: 'desc' }];

type HostHandle = { setSort: (sort: unknown) => void };

/** Holds the repeater's `sort` as state and rebuilds the node on every change. */
const Host = React.forwardRef<HostHandle, { adapter: any }>(function Host({ adapter }, ref) {
  const [sort, setSort] = React.useState<unknown>(BY_NAME_ASC);
  React.useImperativeHandle(ref, () => ({ setSort }), []);
  const schema = React.useMemo(
    () => ({ type: 'element:repeater', id: 'rep', dataSource: { object: 'contact', sort }, properties: { fields: ['name'] } }),
    [sort],
  );
  return (
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer schema={schema as never} />
    </AdapterCtx.Provider>
  );
});

function mount() {
  const adapter = { find: vi.fn(async () => ({ data: [{ id: 'r1', name: 'Ada' }], total: 1 })) };
  const host = React.createRef<HostHandle>();
  render(<Host ref={host} adapter={adapter} />);
  return { adapter, host };
}

/** The `$orderby` of every read the repeater issued, in order. */
const orderbys = (adapter: { find: { mock: { calls: any[][] } } }) =>
  adapter.find.mock.calls.map((c) => c[1]?.$orderby);

describe('element:repeater keys its read on the sort it sends (objectui#10664)', () => {
  it('SUBJECT: a changed sort re-reads, with the new `$orderby`', async () => {
    const { adapter, host } = mount();
    await waitFor(() => expect(screen.getByTestId('repeater')).toBeInTheDocument());
    await settle();
    expect(orderbys(adapter)).toEqual([BY_NAME_ASC]);

    await act(async () => { host.current!.setSort(BY_NAME_DESC); });
    await settle();

    expect(orderbys(adapter), 'the changed sort never reached a read').toEqual([BY_NAME_ASC, BY_NAME_DESC]);
  });

  it('CONTROL: an equal sort in a fresh array does not re-read', async () => {
    const { adapter, host } = mount();
    await waitFor(() => expect(screen.getByTestId('repeater')).toBeInTheDocument());
    await settle();
    const atRest = adapter.find.mock.calls.length;

    await act(async () => { host.current!.setSort([{ field: 'name', order: 'asc' }]); });
    await settle();

    expect(adapter.find.mock.calls.length, 'an equal sort re-read the list').toBe(atRest);
  });
});
