/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * RecordDetailView — the PRODUCER for the header's manual ⟳ (objectui#3460).
 *
 * `RecordContextValue.refresh` has been declared (and consumed nowhere) since
 * the context was introduced: a field the types, the memo dep list and lint all
 * accepted while no code path ever wrote it. This view is its producer, and
 * `page:header` (see `page-header-refresh.test.tsx` in @object-ui/components)
 * is the consumer.
 *
 * Two properties of the wiring can only be checked here, on the host:
 *
 *   1. The published scope is the `'*'` WILDCARD, not this record. The reason a
 *      user reaches for refresh is a write made by someone else — a write this
 *      client never saw, so it cannot know which objects it touched. `'*'` is
 *      the bus's "everything is stale", which is what also reaches the related
 *      lists and the tab-count badges. A record-scoped notify would look
 *      identical on the main record and silently leave those stale, so the
 *      payload is asserted on the bus itself, not inferred from a refetch.
 *   2. The record refetches IN PLACE (AGENTS.md #8 / objectui#2269): the same
 *      `findOne` runs again and the header DOM node survives. A `key=` bump
 *      would also produce a second `findOne` while destroying tab, scroll and
 *      inline-edit state, so "it refetched" alone is not the property.
 *
 * The embedded case pins the #3460 ruling's scope decision: the list drawer and
 * the split-pane preview mount THIS view with `embedded` (ObjectView,
 * ObjectDataPage, InterfaceListPage all do), so the first phase's "no ⟳ in
 * drawer/split-pane" has to be enforced right here at the producer.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx, subscribeDataChanges } from '@object-ui/react';
import type { DataChange } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — same posture as RecordDetailView.feedLoading.test.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT_NAME = 'mes_work_order';
const RECORD_ID = 'WO-1';

const OBJECTS = [
  {
    name: OBJECT_NAME,
    label: 'Work Order',
    managedBy: 'platform',
    fields: {
      id: { type: 'text', label: 'Id' },
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
    },
  },
];

function makeDataSource() {
  // Each read answers a fresh status so a refetch is observable in the DOM as
  // well as in the call count.
  let generation = 0;
  const findOne = vi.fn(async () => {
    generation += 1;
    return { id: RECORD_ID, name: 'WO-0001', status: `gen-${generation}` };
  });
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne,
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

function makeMetadata() {
  return {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as any;
}

function renderDetail(dataSource: any, opts?: { embedded?: boolean }) {
  return render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT_NAME}/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={makeMetadata()}>
        <RecordDetailView
          dataSource={dataSource}
          objects={OBJECTS}
          onEdit={() => {}}
          objectNameOverride={OBJECT_NAME}
          recordIdOverride={RECORD_ID}
          embedded={opts?.embedded}
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

const refreshButton = () => document.querySelector('[data-page-refresh]') as HTMLButtonElement | null;

beforeEach(() => {
  cleanup();
  // Unrelated chrome (approvals, favourites) reaches for the platform API; in
  // jsdom that is a real socket. Answer locally so the only asynchrony here is
  // the record read.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('RecordDetailView — the header ⟳ refetches in place (objectui#3460)', () => {
  it('renders the ⟳ on the standalone record route', async () => {
    const dataSource = makeDataSource();
    renderDetail(dataSource);

    await waitFor(() => expect(refreshButton()).toBeTruthy());
  });

  it('publishes the WILDCARD scope on the invalidation bus, not this record', async () => {
    const dataSource = makeDataSource();
    const changes: DataChange[] = [];
    const unsubscribe = subscribeDataChanges((c) => changes.push(c));
    try {
      renderDetail(dataSource);
      await waitFor(() => expect(refreshButton()).toBeTruthy());

      fireEvent.click(refreshButton()!);

      expect(changes).toEqual([{ objectName: '*' }]);
      // Explicitly NOT the record scope: that would refresh the main record and
      // leave every related list and count badge stale.
      expect(changes[0]).not.toHaveProperty('recordId', RECORD_ID);
    } finally {
      unsubscribe();
    }
  });

  it('re-runs the record read without remounting the page', async () => {
    const dataSource = makeDataSource();
    renderDetail(dataSource);

    await waitFor(() => expect(refreshButton()).toBeTruthy());
    await waitFor(() => expect(dataSource.findOne).toHaveBeenCalledTimes(1));
    const headerBefore = document.querySelector('header');
    expect(headerBefore).toBeTruthy();

    fireEvent.click(refreshButton()!);

    // The bus re-runs the SAME load effect…
    await waitFor(() => expect(dataSource.findOne).toHaveBeenCalledTimes(2));
    // …and the header is the same DOM node it was before the click. A `key=`
    // bump would have refetched too, while throwing away tab/scroll/inline-edit
    // state (AGENTS.md #8).
    expect(document.querySelector('header')).toBe(headerBefore);
    expect(refreshButton()).toBeTruthy();
  });
});

describe('RecordDetailView — embedded hosts opt out of the ⟳ (objectui#3460 ruling)', () => {
  it('renders no ⟳ in a drawer / split-pane host', async () => {
    const dataSource = makeDataSource();
    renderDetail(dataSource, { embedded: true });

    // Wait for the record read to settle so this is "the header rendered and
    // has no ⟳", not "the header hasn't rendered yet".
    await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy());
    expect(refreshButton()).toBeNull();
  });

  it('publishes nothing on the bus for an embedded host', async () => {
    const dataSource = makeDataSource();
    const changes: DataChange[] = [];
    const unsubscribe = subscribeDataChanges((c) => changes.push(c));
    try {
      renderDetail(dataSource, { embedded: true });
      await waitFor(() => expect(dataSource.findOne).toHaveBeenCalled());
      expect(changes).toEqual([]);
    } finally {
      unsubscribe();
    }
  });
});
