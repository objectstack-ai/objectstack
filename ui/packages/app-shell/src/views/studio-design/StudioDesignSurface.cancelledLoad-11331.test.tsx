// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11331 — a Studio pillar whose draft load is cancelled, with no load
 * to replace it, never leaves its canvas on "Loading…".
 *
 * A pillar's draft-load effect raises `loading` as a load starts, and only the
 * load's own `finally` lowered it, behind `if (!cancelled)`. So a load the
 * effect's cleanup cancelled never lowered it, and when the next run started
 * no load of its own the canvas kept the spinner for good. The rule now: the
 * cleanup of a run whose load has not settled takes back what that run's
 * start claimed.
 *
 * Every load under test waits on a gate the test opens, so the author's move
 * lands while the load is in flight on every run, not only on a slow machine.
 *
 *  - Interfaces: the auto-opened dashboard leaf is loading and the author opens
 *    a report leaf, which has no designer and loads nothing. Its canvas state
 *    shows at once and stays once the cancelled load lands. The control row
 *    clicks after the dashboard rendered.
 *  - Data: the open object is loading and the metadata client changes identity
 *    (`useMetadataClient` hands out a new one). The re-run used to skip the load
 *    as already claimed, though the cancelled load installed nothing. It loads
 *    again now. The guard's purpose is pinned beside it: a new client after the
 *    object loaded still reads nothing again, so an edit in progress is kept.
 *  - Automations: no row, because no component input reaches the case. Its
 *    effect returns early only on `!current`, and the pillar never sets `current`
 *    back to null once a flow is open, so a cancelled flow load always has a
 *    replacement. That is a reading of the source, and nothing here re-derives
 *    it. Its cleanup takes the same shape as the other two.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Module-scope import of the lazily loaded dashboard renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const NAV = [
  { id: 'nav_dash', type: 'dashboard', label: 'Customers', dashboardName: 'customer_dashboard' },
  // Only the dashboard designer is registered below, so this leaf renders the
  // canvas's own "no designer" state and starts no draft load.
  { id: 'nav_rep', type: 'report', label: 'Sales report', reportName: 'sales_report' },
];

const DASHBOARD = {
  name: 'customer_dashboard',
  label: 'Customers',
  widgets: [
    { id: 'by_industry', type: 'chart', title: 'By industry', layout: { x: 0, y: 0, w: 6, h: 4 } },
  ],
};

const ACCOUNT = {
  name: 'acme_account',
  label: 'Account',
  fields: [{ name: 'title', label: 'Title', type: 'text' }],
};

/** `layered` reads keyed `type/name` wait on the gate held here until it opens. */
const holds = new Map<string, Promise<void>>();

function hold(key: string): () => Promise<void> {
  let open!: () => void;
  holds.set(key, new Promise<void>((resolve) => (open = resolve)));
  // Opening it lets every read waiting on it finish: each one's continuation
  // is a microtask, and all of them run before the next timer fires.
  return () =>
    act(async () => {
      open();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

/** One server, any number of clients: a new client is a new identity only. */
function makeClient() {
  return {
    list: vi.fn(async (type: string) => {
      if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
      if (type === 'object') return [{ name: 'acme_account', label: 'Account' }];
      return [];
    }),
    listDrafts: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const gate = holds.get(`${type}/${name}`);
      if (gate) await gate;
      if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
      if (type === 'dashboard' && name === 'customer_dashboard') return { effective: DASHBOARD };
      if (type === 'object' && name === 'acme_account') return { effective: ACCOUNT, code: ACCOUNT };
      return { effective: { name } };
    }),
    getDraft: vi.fn(async () => null),
    save: vi.fn(async () => ({})),
    get: vi.fn(async () => undefined),
  };
}

let client = makeClient();
/** Every client handed out in this test, oldest first. */
let clients = [client];

function remintClient(): void {
  client = makeClient();
  clients.push(client);
}

/** `layered` reads of `type/name`, across every client this test handed out. */
function reads(type: string, name: string): number {
  return clients.reduce(
    (n, c) => n + c.layered.mock.calls.filter(([t, nm]) => t === type && nm === name).length,
    0,
  );
}

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The Data pillar's records grid calls `find()` on this adapter: an
// empty-backend `DataSource`, created once below the imports so every render
// gets the same object (objectui#8620).
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';
// The source under test reaches dynamic imports of `@objectstack/lint`; their first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();

registerMetadataPreview('dashboard', DashboardPreview);

afterEach(() => {
  cleanup();
  holds.clear();
  client = makeClient();
  clients = [client];
});

// "The object opened" reads as its Records body being drawn: the pillar draws
// it once the object loaded. (objectui#12511 — it read the header's More menu,
// which retired; the grid here is the real one over an empty data source, so
// it draws its empty state, not its "+" column.)
const OBJECT_OPENED = 'data-records-body';

/** The pillar's canvas: each pillar renders exactly one `main`. */
function canvas(): HTMLElement {
  const main = document.querySelector('main');
  if (!main) throw new Error('canvas not rendered');
  return main;
}

function dataTree() {
  return (
    <MemoryRouter initialEntries={['/studio/com.acme.app/data']}>
      <DataPillar objectName="acme_account" packageId="com.acme.app" />
    </MemoryRouter>
  );
}

describe('Data pillar — a new metadata client while the open object loads (objectui#11331)', () => {
  it('the re-run loads the object again: the cancelled load installed nothing', async () => {
    const openAccount = hold('object/acme_account');
    const { rerender } = render(dataTree());
    await waitFor(() => expect(reads('object', 'acme_account')).toBe(1));
    expect(within(canvas()).getByText('Loading…')).toBeInTheDocument();

    // `useMetadataClient` hands out a new client while the load is in flight.
    remintClient();
    rerender(dataTree());
    await openAccount();

    expect(await screen.findByTestId(OBJECT_OPENED)).toBeInTheDocument();
    expect(within(canvas()).queryByText('Loading…')).toBeNull();
    // Read once by the cancelled load and once by its replacement.
    expect(reads('object', 'acme_account')).toBe(2);
  });

  it('control: the same gated load, with no new client, opens the object', async () => {
    const openAccount = hold('object/acme_account');
    render(dataTree());
    await waitFor(() => expect(reads('object', 'acme_account')).toBe(1));
    await openAccount();

    expect(await screen.findByTestId(OBJECT_OPENED)).toBeInTheDocument();
    expect(within(canvas()).queryByText('Loading…')).toBeNull();
  });

  it('a new client after the object loaded reads nothing again: the buffer is kept', async () => {
    const { rerender } = render(dataTree());
    expect(await screen.findByTestId(OBJECT_OPENED)).toBeInTheDocument();
    expect(reads('object', 'acme_account')).toBe(1);

    remintClient();
    rerender(dataTree());
    // The new client has to have reached the pillar for the count below to
    // mean anything: the header's list read (its ‹ ›, objectstack#36904) is
    // the proof that it did.
    await waitFor(() => expect(client.list).toHaveBeenCalledWith('object', undefined));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(reads('object', 'acme_account')).toBe(1);
    expect(screen.getByTestId(OBJECT_OPENED)).toBeInTheDocument();
  });
});
