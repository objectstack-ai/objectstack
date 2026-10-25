/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6697 (item 3) — TRIAGE, then a pin. `ListView`'s data-fetch effect
 * names the memoised `expandFields` ARRAY in its own dependency array, so a
 * discarded memo cache re-runs the effect and issues an extra
 * `dataSource.find` with nothing an author or a caller controls having
 * changed. The census card explicitly did NOT confirm this member ("`ListView`
 * is large, central plumbing and a false positive here would be costly to
 * chase"), so the first case below is written to answer that question rather
 * than to assume it: it is RED against the unfixed source or the member is not
 * real.
 *
 * Two facts make this component triageable in isolation, both re-derived here
 * rather than taken from the card:
 *
 *  - `buildExpandFields` returns a FRESH array on every call — `[]`, a fresh
 *    collection, or a fresh `.filter()` result — so a recompute always moves
 *    the identity. There is no accidental stability to hide behind.
 *  - Of the fetch effect's ~19 dependencies, exactly TWO are memo-derived:
 *    `expandFields` and `perms`. Everything else is a prop, a `useState`
 *    value, or a plain derived primitive, all stable across a re-render with
 *    unchanged props. The proxy below is scoped by marker so it discards
 *    `expandFields` alone and leaves `perms` (keyed on `[ctx]`) cached, which
 *    is what lets a failure here name `expandFields` and nothing else.
 *
 * Both statements above describe the UNFIXED source, which is what the first
 * case has to be red against. The fix keys the effect on that memo's own
 * INPUTS (`schema.columns`, the view-binding blocks, `objectDef?.fields` —
 * props and state, which a discard cannot move) instead of on its output, so
 * afterwards `perms` is the effect's only memo-derived dependency. The proxy's
 * scope is unchanged either way: the marker is `schema.columns`, which only
 * the `expandFields` memo names.
 *
 * See `plugin-detail/src/__tests__/RelatedList.discardedMemoIdentity.test.tsx`
 * for why the discard has to be forced at the module level: `ListView` reaches
 * `useMemo` through `import * as React from 'react'`, and that namespace is a
 * frozen `[object Module]` that `vi.spyOn`, assignment and `defineProperty`
 * all fail to patch — silently leaving any pin built on them unfalsifiable.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import * as ReactNS from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';

const memoProxy = vi.hoisted(() => ({ markers: [] as unknown[], epoch: 0 }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const realUseMemo = actual.useMemo;
  const patched = (factory: () => unknown, deps?: unknown[]) =>
    Array.isArray(deps) && deps.some((d) => memoProxy.markers.includes(d))
      ? realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  return { ...actual, useMemo: patched, default: { ...(actual.default ?? actual), useMemo: patched } };
});

/** Put memos whose deps name one of `markers` under this file's control. */
function armDiscardProxy(markers: unknown[]): () => void {
  memoProxy.markers = markers;
  return () => {
    memoProxy.markers = [];
  };
}
/** Throw away the armed memos' caches — one discard event, on demand. */
function discardNow(): void {
  memoProxy.epoch += 1;
}

const OBJECT = 'showcase_contact';
/**
 * The marker: `schema.columns` is a dependency of the `expandFields` memo and
 * of nothing else the fetch effect depends on. Held as a module constant so
 * its IDENTITY is what the proxy matches.
 */
const COLUMNS = ['name', 'account'];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'c-1', name: 'Ada', account: 'a-1' }], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text' },
        // A reference field, so `expandFields` carries real content rather
        // than an empty array — the shape a real list actually fetches with.
        account: { type: 'lookup', reference: 'accounts' },
      },
    })),
  } as any;
}

const schemaWith = (columns: string[]): ListViewSchema =>
  ({ type: 'list-view', objectName: OBJECT, columns } as unknown as ListViewSchema);

const SCHEMA = schemaWith(COLUMNS);

const listElement = (ds: any, schema: ListViewSchema) => (
  <SchemaRendererProvider dataSource={ds}>
    <ListView schema={schema} dataSource={ds} />
  </SchemaRendererProvider>
);

const settle = () => new Promise((r) => setTimeout(r, 0));

let prevObjectGrid: any;
beforeAll(() => {
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid);
  else ComponentRegistry.unregister('object-grid');
});
afterEach(() => {
  cleanup();
  memoProxy.markers = [];
});

describe('ListView — the data fetch survives a discarded `expandFields` memo (objectui#6697)', () => {
  it('provesTheProxyDiscriminates: the proxy reaches the same React binding the component uses', () => {
    const MARKER = 'canary-marker';
    const seen: unknown[] = [];
    const Probe: React.FC = () => {
      seen.push(ReactNS.useMemo(() => ({}), [MARKER]));
      return null;
    };

    const restore = armDiscardProxy([MARKER]);
    try {
      const { rerender } = render(<Probe />);
      // Armed but not fired: normal caching still holds.
      rerender(<Probe />);
      expect(seen[1]).toBe(seen[0]);

      discardNow();
      rerender(<Probe />);
    } finally {
      restore();
    }
    expect(seen[2]).not.toBe(seen[1]);
  });

  it('does not re-fetch when `expandFields` is discarded under an UNCHANGED column set', async () => {
    const ds = makeDataSource();
    const restore = armDiscardProxy([COLUMNS]);
    try {
      const { rerender } = render(listElement(ds, SCHEMA));
      await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
      // The value under test really is the one the query carries.
      expect(ds.find.mock.calls[0][1].$expand).toEqual(['account']);

      // One discard, then a re-render with the SAME schema object.
      // `expandFields` recomputes to a NEW array carrying the SAME field
      // names; the schema, the columns and every other dependency are
      // untouched. Nothing here is a reason to re-query the server.
      discardNow();
      rerender(listElement(ds, SCHEMA));
      await settle();

      expect(ds.find).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  /**
   * The counterpart to the case above, and the one a value key over
   * `expandFields` gets WRONG. `buildExpandFields` collapses the whole
   * collected set down to the relation roots, so adding a plain `text` column
   * leaves `$expand` byte-identical — a key derived from that result cannot
   * see the change, and the list goes on serving rows without the new column.
   * `$select` is the assertion because `$select` is what actually moves.
   */
  it('still DOES re-fetch when the columns change WITHOUT changing what must be expanded', async () => {
    const ds = makeDataSource();
    const { rerender } = render(listElement(ds, SCHEMA));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(ds.find.mock.calls[0][1].$select).not.toContain('status');
    expect(ds.find.mock.calls[0][1].$expand).toEqual(['account']);

    rerender(listElement(ds, schemaWith(['name', 'account', 'status'])));

    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(1));
    const last = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    // The expand set is unchanged — only the projection moved.
    expect(last.$expand).toEqual(['account']);
    expect(last.$select).toContain('status');
  });

  it('still DOES re-fetch when the column set genuinely changes what must be expanded', async () => {
    const ds = makeDataSource();
    const { rerender } = render(listElement(ds, SCHEMA));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(ds.find.mock.calls[0][1].$expand).toEqual(['account']);

    // Drop the reference column: `$expand` must follow, which it can only do
    // if the effect still re-runs on a genuine change.
    rerender(listElement(ds, schemaWith(['name'])));

    await waitFor(() => expect(ds.find.mock.calls.length).toBeGreaterThan(1));
    const last = ds.find.mock.calls[ds.find.mock.calls.length - 1][1];
    expect(last.$expand).toBeUndefined();
  });
});
