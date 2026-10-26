/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6697 (item 2) — `page:tabs`' related-count probe must survive a
 * DISCARDED `probeTargets` memo.
 *
 * `probeTargets` is a `Map`, and the count-probing effect right below it names
 * that Map in its OWN dependency array. `useMemo` is a pure optimisation, not
 * a correctness dependency: React may throw the cache away and recompute even
 * when `[items, recordObject]` compare equal, and the factory builds a brand
 * new `Map` every time. So a discard alone re-ran the effect and re-probed
 * every tab's count with nothing an author or a caller controls having
 * changed.
 *
 * ⚠️ WHAT THE OBSERVABLE ACTUALLY IS — re-measured here, because the census
 * card overstates it. The card calls the cost "an extra count-probe round
 * trip". `RelatedCountStore.fetch` returns the CACHED number as its first act
 * and dedupes concurrent calls through `inflight`, so a re-probe of an
 * already-warm key issues NO `dataSource.find` at all. The wire cost of a
 * discard is therefore normally ZERO, and the honest observable — the one this
 * file pins — is the redundant `RelatedCountStore.fetch` invocation the effect
 * makes. Both are asserted below so the distinction survives in the record.
 *
 * See `plugin-detail/src/__tests__/RelatedList.discardedMemoIdentity.test.tsx`
 * for why the discard is forced at the module level rather than by varying a
 * prop, and why a pin built on `vi.spyOn(React, 'useMemo')` would be
 * unfalsifiable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import * as ReactNS from 'react';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { RelatedCountStore } from '../hooks/related-count-store';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there
// the cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

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

/**
 * The marker. `probeTargets` is keyed on `[items, recordObject]`, and
 * `recordObject` is the only one of the two this file can name. Marking it
 * also discards `RecordContextProvider`'s own memo, which is harmless: every
 * value the probe effect reads off the context (`dataSource`, `data.id`) is a
 * stable reference or a primitive, so that memo recomputing changes nothing
 * the effect compares. The post-fix green is what proves it.
 */
const RECORD_OBJECT = 'zz_probe_account';
const PARENT_ID = 'ACC-1';
const CHILD_OBJECT = 'zz_probe_contact';

const tabsSchema = (childObject: string) => ({
  type: 'page:tabs',
  id: 'tabs',
  items: [
    // Two tabs minimum — the strip hides itself at length 1.
    { label: 'Details', value: 'details', children: [{ type: 'element:text', properties: { content: 'DETAILS' } }] },
    {
      label: 'Contacts',
      value: 'contacts',
      children: [
        { type: 'record:related_list', properties: { objectName: childObject, relationshipField: 'account' } },
      ],
    },
  ],
});

const makeDS = () => ({
  find: vi.fn(async () => ({ data: [{ id: 'c-1' }], total: 3 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

const tree = (ds: any, childObject: string) => (
  <RecordContextProvider
    objectName={RECORD_OBJECT}
    recordId={PARENT_ID}
    data={{ id: PARENT_ID }}
    dataSource={ds as any}
  >
    <SchemaRenderer schema={tabsSchema(childObject) as any} />
  </RecordContextProvider>
);

const settle = () => new Promise((r) => setTimeout(r, 0));

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  RelatedCountStore._reset();
  fetchSpy = vi.spyOn(RelatedCountStore, 'fetch');
});
afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
  RelatedCountStore._reset();
  memoProxy.markers = [];
});

describe('page:tabs — the count probe survives a discarded `probeTargets` memo (objectui#6697)', () => {
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

  it('does not re-probe when `probeTargets` is discarded under an UNCHANGED tab set', async () => {
    const ds = makeDS();
    const restore = armDiscardProxy([RECORD_OBJECT]);
    try {
      const { rerender } = render(tree(ds, CHILD_OBJECT));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
      // Settle to a RESTING count first. The store bumps its version when the
      // first probe resolves, and `countsVersion` is a dependency of the probe
      // effect BY DESIGN (objectui#2269: an invalidation has to re-probe), so
      // mount legitimately costs more than one `fetch` call before the loop
      // quiesces. Anchoring on "called once" instead would measure that
      // designed re-probe and blame it on the discard.
      await settle();
      await settle();
      const atRest = fetchSpy.mock.calls.length;
      const findsAtRest = ds.find.mock.calls.length;
      expect(atRest).toBeGreaterThan(0);

      // One discard, then a re-render of the same tree. `probeTargets`
      // reconstructs an equal-content `Map` with a new identity; the tabs,
      // their related lists, the parent id and the data source are all
      // untouched. Nothing here is a reason to probe again.
      discardNow();
      rerender(tree(ds, CHILD_OBJECT));
      await settle();

      expect(fetchSpy.mock.calls.length).toBe(atRest);
      // The store would have absorbed a redundant probe anyway (see header):
      // this is the "no wire cost either way" half of the record.
      expect(ds.find.mock.calls.length).toBe(findsAtRest);
    } finally {
      restore();
    }
  });

  it('still DOES probe again when a tab genuinely points at a different object', async () => {
    const ds = makeDS();
    const { rerender } = render(tree(ds, CHILD_OBJECT));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][1]).toBe(CHILD_OBJECT);

    rerender(tree(ds, 'zz_probe_case'));

    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(1));
    const last = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    expect(last[1]).toBe('zz_probe_case');
  });
});
