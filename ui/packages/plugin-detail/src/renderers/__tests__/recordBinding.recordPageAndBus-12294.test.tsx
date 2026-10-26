/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The record blocks' `dataSource` binding beside a RECORD PAGE, and on the
 * data-invalidation bus (objectui#12294).
 *
 *  1. The record page path is unchanged: with no binding on the block, the
 *     page's own record context reaches it, and no row is read.
 *  2. With a binding, the binding wins for that block — the spec's
 *     "Overrides the page-level object context for this block" — and it does
 *     NOT join the two providers that are about the PAGE's record: the page's
 *     inline-edit session (whose Save bar writes the page record) and the
 *     page's highlight-field registry (which trims the page's details body).
 *  3. The bound record is a FETCHING record context, so it re-reads when the
 *     bound object is written elsewhere on the page (objectstack#4444's bar):
 *     a write through the adapter (the mutation bridge) and a write announced
 *     on the bus by hand (a server action the host reports) both refresh it in
 *     place.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  HighlightFieldsProvider,
  InlineEditProvider,
  RecordContextProvider,
  SchemaRendererProvider,
  notifyDataChanged,
  useMutationInvalidationBridge,
} from '@object-ui/react';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';

/** `useRecordEditable`'s explain probe, answered with its fail-open 501 (see the app-page suite). */
vi.stubGlobal('fetch', (async () => new Response(null, { status: 501 })) as unknown as typeof globalThis.fetch);

const PAGE_OBJECT = 'crm_account';
const BOUND_OBJECT = 'sys_environment';

const SCHEMAS: Record<string, unknown> = {
  [PAGE_OBJECT]: {
    name: PAGE_OBJECT,
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      region: { name: 'region', type: 'text', label: 'Region' },
      rank: { name: 'rank', type: 'number', label: 'Rank' },
    },
  },
  [BOUND_OBJECT]: {
    name: BOUND_OBJECT,
    fields: {
      name: { name: 'name', type: 'text', label: 'Name' },
      region: { name: 'region', type: 'text', label: 'Region' },
    },
  },
};

type Row = Record<string, unknown>;

/** A stateful adapter: `update` writes the store and emits the `MutationEvent` the bridge listens to. */
function makeAdapter(store: Record<string, Row[]>) {
  const listeners = new Set<(e: { type: string; resource: string; id?: string }) => void>();
  return {
    store,
    find: vi.fn(async (object: string, params?: { $top?: number }) => {
      const rows = (store[object] ?? []).map((r) => ({ ...r }));
      return { data: typeof params?.$top === 'number' ? rows.slice(0, params.$top) : rows, total: rows.length };
    }),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async (object: string, id: string, patch: Row) => {
      const row = (store[object] ?? []).find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      for (const l of listeners) l({ type: 'update', resource: object, id });
      return row;
    }),
    delete: vi.fn(async () => true),
    getObjectSchema: vi.fn(async (object: string) => SCHEMAS[object]),
    onMutation: (cb: (e: { type: string; resource: string; id?: string }) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const PAGE_RECORD = { id: 'acc-1', name: 'Page account', region: 'Page region', rank: 7 };
const BINDING = { object: BOUND_OBJECT, limit: 1 };

/** The record page's own providers, around whatever blocks it places. */
function RecordPage({ adapter, children }: { adapter: ReturnType<typeof makeAdapter>; children: React.ReactNode }) {
  return (
    <SchemaRendererProvider dataSource={adapter as any}>
      <RecordContextProvider
        objectName={PAGE_OBJECT}
        recordId={PAGE_RECORD.id}
        data={PAGE_RECORD}
        objectSchema={SCHEMAS[PAGE_OBJECT]}
        dataSource={adapter as any}
      >
        <HighlightFieldsProvider>
          <InlineEditProvider canEdit>{children}</InlineEditProvider>
        </HighlightFieldsProvider>
      </RecordContextProvider>
    </SchemaRendererProvider>
  );
}

afterEach(() => cleanup());

describe('the record page path, and a bound block placed on it (objectui#12294)', () => {
  it('an unbound block reads the page record, and reads no row of its own', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Bound env' }] });
    render(
      <RecordPage adapter={adapter}>
        <RecordHighlightsRenderer schema={{ fields: ['name'] } as any} />
      </RecordPage>,
    );
    expect(await screen.findByText('Page account')).toBeInTheDocument();
    expect(adapter.find).not.toHaveBeenCalled();
  });

  it('a bound block shows the bound row instead — the binding overrides the page record', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Bound env' }] });
    render(
      <RecordPage adapter={adapter}>
        <RecordHighlightsRenderer schema={{ fields: ['name'], dataSource: BINDING } as any} />
      </RecordPage>,
    );
    expect(await screen.findByText('Bound env')).toBeInTheDocument();
    expect(screen.queryByText('Page account')).not.toBeInTheDocument();
    expect(adapter.find.mock.calls[0][0]).toBe(BOUND_OBJECT);
  });

  it('a bound record:details does not join the page record\'s inline-edit session', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Bound env', region: 'Bound region' }] });
    render(
      <RecordPage adapter={adapter}>
        <div data-testid="page-details">
          <RecordDetailsRenderer schema={{ fields: ['region'] } as any} />
        </div>
        <div data-testid="bound-details">
          <RecordDetailsRenderer schema={{ fields: ['region'], dataSource: BINDING } as any} />
        </div>
      </RecordPage>,
    );
    const page = screen.getByTestId('page-details');
    const bound = screen.getByTestId('bound-details');
    await within(page).findByText('Page region');
    await within(bound).findByText('Bound region');
    // Control: the page's own details offers in-place editing in this session,
    // so the probe below can see the affordance when it is there.
    await waitFor(() => expect(page.querySelector('svg.lucide-pencil')).not.toBeNull());
    // The bound record's fields never enter the page record's draft.
    expect(bound.querySelector('svg.lucide-pencil')).toBeNull();
  });

  it('a bound record:highlights does not trim the page record\'s details body', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Bound env', region: 'Bound region' }] });
    const details = <RecordDetailsRenderer schema={{ fields: ['region', 'rank'] } as any} />;

    // Control: an UNBOUND highlights strip naming `region` takes it out of the
    // page's details body — the dedupe the registry exists for.
    const control = render(
      <RecordPage adapter={adapter}>
        <RecordHighlightsRenderer schema={{ fields: ['region'] } as any} />
        <div data-testid="body">{details}</div>
      </RecordPage>,
    );
    await waitFor(() => expect(within(screen.getByTestId('body')).queryByText('Page region')).not.toBeInTheDocument());
    control.unmount();

    render(
      <RecordPage adapter={adapter}>
        <RecordHighlightsRenderer schema={{ fields: ['region'], dataSource: BINDING } as any} />
        <div data-testid="body">{details}</div>
      </RecordPage>,
    );
    expect(await screen.findByText('Bound region')).toBeInTheDocument();
    expect(within(screen.getByTestId('body')).getByText('Page region')).toBeInTheDocument();
  });
});

/** Mounts the app-wide mutation bridge, as the console does once per app. */
function Bridge({ adapter }: { adapter: unknown }) {
  useMutationInvalidationBridge(adapter);
  return null;
}

describe('a bound record block is on the data-invalidation bus (objectui#12294, objectstack#4444)', () => {
  function mountBound(adapter: ReturnType<typeof makeAdapter>) {
    return render(
      <SchemaRendererProvider dataSource={adapter as any}>
        <Bridge adapter={adapter} />
        <RecordHighlightsRenderer schema={{ fields: ['name'], dataSource: BINDING } as any} />
      </SchemaRendererProvider>,
    );
  }

  it('re-reads the bound row after a write through the adapter elsewhere on the page', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Before write' }] });
    mountBound(adapter);
    expect(await screen.findByText('Before write')).toBeInTheDocument();

    // e.g. an inline save in a `record:details` of the same row, or any form.
    await act(async () => {
      await adapter.update(BOUND_OBJECT, 'env-1', { name: 'After write' });
    });

    expect(await screen.findByText('After write')).toBeInTheDocument();
    expect(screen.queryByText('Before write')).not.toBeInTheDocument();
    expect(adapter.find).toHaveBeenCalledTimes(2);
  });

  it('re-reads the bound row when a write is announced on the bus by hand', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Before action' }] });
    mountBound(adapter);
    expect(await screen.findByText('Before action')).toBeInTheDocument();

    // e.g. a `record:quick_actions` server action: it writes over raw HTTP,
    // past the adapter, and the host announces the change on the bus.
    adapter.store[BOUND_OBJECT][0].name = 'After action';
    act(() => notifyDataChanged({ objectName: BOUND_OBJECT, recordId: 'env-1' }));

    expect(await screen.findByText('After action')).toBeInTheDocument();
  });

  it('does not re-read for a write to another object', async () => {
    const adapter = makeAdapter({ [BOUND_OBJECT]: [{ id: 'env-1', name: 'Steady' }] });
    mountBound(adapter);
    expect(await screen.findByText('Steady')).toBeInTheDocument();
    act(() => notifyDataChanged({ objectName: PAGE_OBJECT, recordId: 'acc-1' }));
    await act(async () => {});
    expect(adapter.find).toHaveBeenCalledTimes(1);
  });
});
