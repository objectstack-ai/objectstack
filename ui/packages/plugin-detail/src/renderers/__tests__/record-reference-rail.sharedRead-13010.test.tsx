/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#13010 part 4 — a `record:reference_rail` card and a `page:tabs`
 * badge counting the same unfiltered related list share ONE read.
 *
 * The rail claims its rows in `RelatedCountStore` while it renders; the badge's
 * probe (`RelatedCountStore.fetch`, the call `page:tabs` makes) asks for the
 * claimed rows with the count when it finds a claim, and the card takes them.
 * The rail's first read goes through the store, so a badge that asks after it
 * joins it. These pins drive both orders explicitly, with no reliance on which
 * effect, microtask or frame comes first, and hold the three things that must
 * NOT change: a rail alone waits for visibility, a refresh reads again, and a
 * badge with a declared filter keeps its own probe.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { RecordContextProvider, notifyDataChanged } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';

import { RecordReferenceRailRenderer } from '../record-reference-rail';

const PARENT = 'crm_account';
const REC = 'A-13010';
const CHILD = 'crm_contact';
const FIELD = 'account';

/** The rail on screen: every observed element intersects at once. */
class VisibleIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

/** The rail scrolled into view when the test says so. */
class LaterIO {
  static callbacks: Array<(records: { isIntersecting: boolean }[]) => void> = [];
  constructor(cb: (records: { isIntersecting: boolean }[]) => void) {
    LaterIO.callbacks.push(cb);
  }
  static show() {
    for (const cb of LaterIO.callbacks) cb([{ isIntersecting: true }]);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

/** The rail off screen (the `hidden xl:flex` aside below `xl`): never intersects. */
class HiddenIO {
  observe() {}
  disconnect() {}
  unobserve() {}
}

interface Deferred {
  query: any;
  resolve: () => void;
}

/** A data source whose reads wait until the test answers them. */
function heldDataSource(total = 5) {
  let rows = Array.from({ length: total }, (_, i) => ({ id: `c${i}`, name: `Contact ${i}` }));
  const pending: Deferred[] = [];
  const find = vi.fn(
    (_object: string, query: any) =>
      new Promise((resolve) => {
        pending.push({
          query,
          resolve: () => resolve({ data: rows.slice(0, query.$top), total: rows.length }),
        });
      }),
  );
  return {
    find,
    getObjectSchema: vi.fn(async () => ({ name: CHILD, fields: { [FIELD]: { type: 'lookup', reference: PARENT } } })),
    pending,
    setRows(next: Array<{ id: string; name: string }>) {
      rows = next;
    },
    async answerAll() {
      await act(async () => {
        for (const d of pending.splice(0)) d.resolve();
        await new Promise((r) => setTimeout(r, 0));
      });
    },
  };
}

const RAIL = { entries: [{ objectName: CHILD, relationshipField: FIELD, title: 'Contacts', limit: 3 }] };

function mountRail(ds: ReturnType<typeof heldDataSource>) {
  return render(
    <MemoryRouter>
      <RecordContextProvider objectName={PARENT} recordId={REC} dataSource={ds as never}>
        <RecordReferenceRailRenderer schema={RAIL as never} />
      </RecordContextProvider>
    </MemoryRouter>,
  );
}

/** The call `page:tabs` makes for an unfiltered related list's badge. */
const badgeProbe = (ds: ReturnType<typeof heldDataSource>, filter?: unknown) =>
  RelatedCountStore.fetch(
    (object: string, query: any) => ds.find(object, query) as never,
    CHILD,
    FIELD,
    REC,
    filter as never,
  );

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => RelatedCountStore._reset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  RelatedCountStore._reset();
});

describe('a rail card and a tab badge over the same list share one read (objectui#13010)', () => {
  it('badge first: the probe asks for the card\'s rows, and the card takes them later without a read', async () => {
    LaterIO.callbacks = [];
    vi.stubGlobal('IntersectionObserver', LaterIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    // The rail renders (and claims) before the badge's probe runs, as on a page
    // where both render in one commit; it is off screen, so it reads nothing.
    mountRail(ds);
    const count = badgeProbe(ds);
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(ds.pending[0].query).toMatchObject({ $top: 3, $count: true });
    await ds.answerAll();
    expect(await count).toBe(5);

    // The rail comes on screen after the read has settled: it takes the rows
    // the badge's read holds for it.
    act(() => LaterIO.show());
    expect(await screen.findByText('Contact 2')).toBeInTheDocument();
    expect(screen.queryByText('Contact 3')).toBeNull();
    expect(screen.getByText('5')).toBeInTheDocument();
    // One read for the badge and the card together.
    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('badge first, rail visible while the read is out: one read draws both', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    // Claim in render, then the probe, then the rail's own visible fetch —
    // which, through the store, joins the probe's read in flight.
    RelatedCountStore.claimRows(CHILD, FIELD, REC, 3);
    const count = badgeProbe(ds);
    mountRail(ds);
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(ds.pending[0].query).toMatchObject({ $top: 3, $count: true });
    await ds.answerAll();
    expect(await count).toBe(5);
    expect(await screen.findByText('Contact 2')).toBeInTheDocument();
    expect(RelatedCountStore.get(CHILD, FIELD, REC)).toBe(5);
    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('rail first: the badge joins the card\'s read for its total', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    mountRail(ds);
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(1);
    const count = badgeProbe(ds);
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(1);
    await ds.answerAll();
    expect(await count).toBe(5);
    expect(await screen.findByText('Contact 2')).toBeInTheDocument();
    expect(ds.find).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a rail alone on the page still waits for visibility — a claim reads nothing', async () => {
    vi.stubGlobal('IntersectionObserver', HiddenIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    mountRail(ds);
    await flush();
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('CONTROL: a rail alone on the page reads its own rows once visible, on the wire it always sent', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    mountRail(ds);
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(1);
    expect(ds.find.mock.calls[0][1]).toEqual({ $filter: { [FIELD]: REC }, $top: 3, $count: true });
    await ds.answerAll();
    expect(await screen.findByText('Contact 2')).toBeInTheDocument();
  });

  it('CONTROL: a badge with a declared filter keeps its own one-row probe beside the card', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    mountRail(ds);
    const scoped = [{ field: 'status', operator: 'equals', value: 'active' }];
    const count = badgeProbe(ds, scoped);
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(2);
    const tops = ds.pending.map((d) => d.query.$top).sort();
    expect(tops).toEqual([1, 3]);
    await ds.answerAll();
    await count;
  });

  it('CONTROL: a refresh reads again, and draws the new rows, though the store held rows for the card', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource(2);
    RelatedCountStore.claimRows(CHILD, FIELD, REC, 3);
    const count = badgeProbe(ds);
    mountRail(ds);
    await flush();
    await ds.answerAll();
    await count;
    expect(await screen.findByText('Contact 1')).toBeInTheDocument();
    expect(ds.find).toHaveBeenCalledTimes(1);

    // What a record action with `refreshAfter: true` posts: a change to the
    // parent record, which may have written children. The store holds nothing
    // for the parent object, so only the rail's own re-read can see it.
    ds.setRows([
      { id: 'c0', name: 'Contact 0' },
      { id: 'c1', name: 'Contact 1' },
      { id: 'c9', name: 'Contact 9' },
    ]);
    act(() => notifyDataChanged({ objectName: PARENT, recordId: REC }));
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(2);
    await ds.answerAll();
    expect(await screen.findByText('Contact 9')).toBeInTheDocument();
  });

  it('a parent-record change before the rail is on screen: its first read is fresh, not the rows held before the change', async () => {
    LaterIO.callbacks = [];
    vi.stubGlobal('IntersectionObserver', LaterIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource(2);
    // Off screen (below `xl`): the rail claims, the badge's read fetches and
    // holds the card's rows, the rail reads nothing.
    mountRail(ds);
    const count = badgeProbe(ds);
    await flush();
    await ds.answerAll();
    await count;
    expect(ds.find).toHaveBeenCalledTimes(1);

    // A `refreshAfter: true` action writes a child and posts a PARENT change:
    // the store's child keys are not invalidated, so its held rows predate it.
    ds.setRows([
      { id: 'c0', name: 'Contact 0' },
      { id: 'c1', name: 'Contact 1' },
      { id: 'c9', name: 'Contact 9' },
    ]);
    act(() => notifyDataChanged({ objectName: PARENT, recordId: REC }));
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(1);

    // The rail comes on screen: it reads again and draws the row the action wrote.
    act(() => LaterIO.show());
    await flush();
    expect(ds.find).toHaveBeenCalledTimes(2);
    await ds.answerAll();
    expect(await screen.findByText('Contact 9')).toBeInTheDocument();
  });

  it('CONTROL: the rail\'s unmount releases its claim — a badge alone asks for one row again', async () => {
    vi.stubGlobal('IntersectionObserver', HiddenIO as unknown as typeof IntersectionObserver);
    const ds = heldDataSource();
    const view = mountRail(ds);
    view.unmount();
    const count = badgeProbe(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(ds.pending[0].query).toMatchObject({ $top: 1, $count: true });
    await ds.answerAll();
    await count;
  });
});
