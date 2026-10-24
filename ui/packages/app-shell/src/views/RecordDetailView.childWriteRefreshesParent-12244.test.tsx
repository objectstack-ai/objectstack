/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12244 — a write to a CHILD in a related list refreshes the parent
 * record's displayed rollups, in place.
 *
 * The reported reach (hosted HotCRM 4.0.1, QTE-0007 → Related): edit a line's
 * quantity, then delete a line. The server recalculated the quote's
 * `total_price` each time (an `afterInsert` / `afterUpdate` / `afterDelete`
 * hook on the line-item object rolls it up), yet the header kept showing the
 * old total until a browser reload.
 *
 * Mechanism: every block of the record page — the header's highlight strip
 * included — reads the ONE row `RecordDetailView` loads. That load re-ran on
 * the invalidation bus (objectui#2269) only for a change to THIS record or THIS
 * object, while a child write reaches the bus under the CHILD's name: through
 * the console's MutationEvent bridge for a dataSource write (a row delete, the
 * form overlay's save), or through `notifyRelatedChanged` for a row action.
 * Neither ever matched the parent, so the parent row stayed as first loaded.
 *
 * What this file pins, through the real page and the real bridge:
 *
 *   1. A row Delete in the related list re-reads the parent and the header
 *      shows the server's recomputed total.
 *   2. A child UPDATE through the dataSource (the write the form overlay makes)
 *      does the same.
 *   3. A child row action that bypasses the dataSource (posted as an
 *      object-wide change by `notifyRelatedChanged`) does the same.
 *   4. The refetch is IN PLACE (AGENTS.md #8): the header is the same DOM node
 *      and the Related tab stays the active tab.
 *   5. Scope stays tight: a write to an object that is not one of the page's
 *      related children does not re-read the parent, and a `'*'` or a change
 *      to the parent itself reads it once, not twice.
 *
 * The fake backend recomputes the rollup itself, the way the server's hook
 * does, so the figure the header shows can only have come from a fresh read
 * of the parent — the client computes no rollup (the card's premise: the
 * server returns the recalculated value on the parent's read).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataCtx, notifyDataChanged, useMutationInvalidationBridge } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';
import type { DataSourceMutationEvent } from '@object-ui/types';

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

// Orthogonal chrome — same posture as RecordDetailView.relatedListFilter-4664.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

/**
 * Desktop, pinned (objectui#8399): below the 768 breakpoint a related list
 * renders as cards with no row-actions menu, and the delete case drives that
 * menu.
 */
beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const APP = 'crm';
const PARENT = 'quote';
const CHILD = 'quote_line';
const UNRELATED = 'task';
const RECORD_ID = 'q-7';

const parentObject = {
  name: PARENT,
  label: 'Quote',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    total_price: { type: 'number', label: 'Total' },
  },
  // The header's highlight strip carries the rollup, as HotCRM's quote does.
  highlightFields: ['total_price'],
};

const childObject = {
  name: CHILD,
  label: 'Quote Line',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'number', label: 'Unit Price' },
    [PARENT]: {
      type: 'master_detail',
      reference: PARENT,
      label: 'Quote',
      relatedListColumns: ['name', 'quantity'],
    },
  },
};

/** An object with no relationship to the parent at all. */
const unrelatedObject = {
  name: UNRELATED,
  label: 'Task',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
};

const OBJECTS = [parentObject, childObject, unrelatedObject];

/**
 * A backend that owns the rollup: every child write recomputes the parent's
 * `total_price` server-side, and the client only ever learns the new figure by
 * reading the parent again. Writes are announced through `onMutation`, the
 * event the console's MutationEvent bridge fans out onto the bus.
 */
function makeBackend() {
  const lines = [
    { id: 'l-1', name: 'Seat licence', quantity: 3, unit_price: 2000, [PARENT]: RECORD_ID },
    { id: 'l-2', name: 'Onboarding', quantity: 1, unit_price: 3000, [PARENT]: RECORD_ID },
  ];
  const rollup = () => lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const listeners = new Set<(e: DataSourceMutationEvent) => void>();
  const emit = (e: DataSourceMutationEvent) => {
    for (const l of Array.from(listeners)) l(e);
  };
  const ds = {
    find: vi.fn(async (objectName: string) => {
      if (objectName !== CHILD) return { data: [], total: 0 };
      return { data: lines.map((l) => ({ ...l })), total: lines.length };
    }),
    findOne: vi.fn(async (objectName: string, id: string) => {
      if (objectName !== PARENT || id !== RECORD_ID) return null;
      return { id: RECORD_ID, name: 'QTE-0007', total_price: rollup() };
    }),
    create: vi.fn(async (_o: string, row: Record<string, unknown>) => row),
    update: vi.fn(async (objectName: string, id: string, patch: { quantity?: number; name?: string }) => {
      if (objectName === CHILD) {
        const line = lines.find((l) => l.id === id);
        if (line) Object.assign(line, patch);
      }
      emit({ type: 'update', resource: objectName, id });
      return { id, ...patch };
    }),
    delete: vi.fn(async (objectName: string, id: string) => {
      if (objectName === CHILD) {
        const at = lines.findIndex((l) => l.id === id);
        if (at >= 0) lines.splice(at, 1);
      }
      emit({ type: 'delete', resource: objectName, id });
      return true;
    }),
    onMutation: (cb: (e: DataSourceMutationEvent) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { ds, rollup };
}

type FakeDataSource = ReturnType<typeof makeBackend>['ds'];

/** The console mounts the MutationEvent bridge once, in `AppContent`. */
function ConsoleHost({ dataSource, children }: { dataSource: unknown; children: React.ReactNode }) {
  useMutationInvalidationBridge(dataSource);
  return <>{children}</>;
}

function renderPage(ds: FakeDataSource) {
  const metadata = {
    objects: OBJECTS,
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as unknown as React.ContextType<typeof MetadataCtx>;
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/${PARENT}/record/${RECORD_ID}?tab=related`]}>
      <MetadataCtx.Provider value={metadata}>
        <ConsoleHost dataSource={ds}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/record/:recordId"
              element={<RecordDetailView dataSource={ds} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </ConsoleHost>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** Reads of the PARENT record — the read every header block draws from. */
const parentReads = (ds: FakeDataSource) =>
  ds.findOne.mock.calls.filter(([objectName, id]) => objectName === PARENT && id === RECORD_ID).length;

/** Is `figure` (e.g. 9000) on screen, in any grouping the number formatter picks? */
const figureShown = (figure: number) => {
  const plain = String(figure);
  const grouped = figure.toLocaleString('en-US');
  const text = document.body.textContent ?? '';
  return text.includes(plain) || text.includes(grouped);
};

async function settledPage() {
  const backend = makeBackend();
  renderPage(backend.ds);
  await waitFor(() => expect(parentReads(backend.ds)).toBe(1));
  await screen.findByText('Seat licence');
  await waitFor(() => expect(figureShown(backend.rollup())).toBe(true));
  return backend;
}

beforeEach(() => {
  cleanup();
  RelatedCountStore._reset();
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
  vi.restoreAllMocks();
});

describe('RecordDetailView — a child write in a related list refreshes the parent (objectui#12244)', () => {
  it('a row Delete in the related list re-reads the parent and shows the recomputed total', async () => {
    const { ds, rollup } = await settledPage();
    expect(rollup()).toBe(9000);
    const headerBefore = document.querySelector('header');
    expect(headerBefore).toBeTruthy();

    const row = screen.getByText('Seat licence').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Row actions' }));
    await userEvent.click(await screen.findByTestId('row-action-builtin-delete'));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(ds.delete).toHaveBeenCalledWith(CHILD, 'l-1'));
    expect(rollup()).toBe(3000);
    await waitFor(() => expect(parentReads(ds)).toBe(2));
    await waitFor(() => expect(figureShown(3000)).toBe(true));
    expect(figureShown(9000)).toBe(false);
    // In place: the same header node, the Related tab still the active one.
    expect(document.querySelector('header')).toBe(headerBefore);
    expect(screen.getByRole('tab', { name: /Related/i }).getAttribute('aria-selected')).toBe('true');
  });

  it('a child update through the dataSource (the form overlay\'s save) re-reads the parent', async () => {
    const { ds, rollup } = await settledPage();
    const headerBefore = document.querySelector('header');

    await act(async () => {
      await ds.update(CHILD, 'l-2', { quantity: 2 });
    });

    expect(rollup()).toBe(12000);
    await waitFor(() => expect(parentReads(ds)).toBe(2));
    await waitFor(() => expect(figureShown(12000)).toBe(true));
    expect(document.querySelector('header')).toBe(headerBefore);
  });

  it('a child row action that bypasses the dataSource (an object-wide child change) re-reads the parent', async () => {
    const { ds } = await settledPage();

    // What `notifyRelatedChanged(child)` posts after a successful row action.
    act(() => {
      notifyDataChanged({ objectName: CHILD });
    });

    await waitFor(() => expect(parentReads(ds)).toBe(2));
  });

  it('a write to an object that is not a related child does not re-read the parent', async () => {
    const { ds } = await settledPage();

    await act(async () => {
      await ds.update(UNRELATED, 't-1', { name: 'Call back' });
    });
    // Let any refetch the change could have scheduled land before reading.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(parentReads(ds)).toBe(1);
  });

  it('a `*` change and a change to the parent itself each read the parent once, not twice', async () => {
    const { ds } = await settledPage();

    act(() => {
      notifyDataChanged({ objectName: '*' });
    });
    await waitFor(() => expect(parentReads(ds)).toBe(2));

    act(() => {
      notifyDataChanged({ objectName: PARENT, recordId: RECORD_ID });
    });
    await waitFor(() => expect(parentReads(ds)).toBe(3));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(parentReads(ds)).toBe(3);
  });
});
