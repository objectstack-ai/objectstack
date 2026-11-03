// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28567 (ADR-0146 D4 · Q6) — "New similar" in the Automations
 * pillar's ⋯ menu, over the flow clone door (`POST /automation/<name>/clone`).
 *
 * The pins, each against a control that discriminates it:
 *  - on a read-only base the request carries NO `package` (the door picks the
 *    paired `<base>.custom`), and the copy opens in the package the answer
 *    named, on that package's Automations pillar, with the door's sentence
 *    shown as sent; the base's menu draws no Delete;
 *  - on a writable package the request names the open package, and the copy
 *    opens in this pillar after a re-read, Delete still offered;
 *  - a `409` (name taken) is the server's sentence, verbatim, the dialog stays
 *    open on the names typed, and nothing opens;
 *  - an answer that names no package opens nothing and says so;
 *  - without `manage_metadata` the item draws disabled, and nothing is sent;
 *  - the package-less scope draws no menu (no pair, no package to name).
 *
 * The harness is `AutomationsPillar.deleteFlow-27356`'s: the metadata server
 * doubled at the client, the `/automation` doors doubled at `fetch`, and the
 * pillar mounted under the Studio's package route, keyed by package as the
 * surface mounts it, so a navigation to another package remounts it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const WRITABLE = 'com.acme.app';

const NOTICE =
  'The copy is switched off and does not run until you switch it on, ' +
  'and it still uses the same subflows, actions and objects as the original.';
const TAKEN =
  'A flow named "approval_copy" already exists. The automation engine keys flows by bare name, so a clone takes a NEW name.';

const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** The server's state: the flows each package holds, and the clone door's next answer. */
const server = vi.hoisted(() => ({
  flows: {} as Record<string, Array<{ name: string; label: string }>>,
  clone: null as null | { status: number; body: unknown },
  canAuthor: true,
}));

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (_type: string, opts?: { packageId?: string }) => (opts?.packageId ? server.flows[opts.packageId] ?? [] : [])),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_t: string, name: string) => ({
    code: null,
    overlay: null,
    effective: { ...FLOW, name, label: name === 'approval' ? 'Approval' : 'Approval (copy)' },
    lock: 'none',
  })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => server.canAuthor,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

// ── The `/automation` doors, doubled at `fetch` ───────────────────────────

const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith('/clone') && server.clone) {
    return new Response(JSON.stringify(server.clone.body), {
      status: server.clone.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  // `/automation/_status`: "absent", the pillar's documented fallback.
  return new Response('null', { status: 404, headers: { 'content-type': 'application/json' } });
});
vi.stubGlobal('fetch', fetchMock);

const cloneCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/clone'));
const cloneBody = (i = 0) => JSON.parse(String(cloneCalls()[i][1]?.body));

/** The clone door's success answer (`CloneFlowResponseSchema`). */
function landedIn(packageId: string | undefined) {
  return {
    status: 200,
    body: {
      success: true,
      data: {
        flow: { ...FLOW, name: 'approval_copy', label: 'Approval (copy)', status: 'obsolete' },
        ...(packageId ? { packageId } : {}),
        notice: NOTICE,
      },
    },
  };
}

beforeEach(() => {
  server.flows = { [BASE]: [{ name: 'approval', label: 'Approval' }], [WRITABLE]: [{ name: 'approval', label: 'Approval' }], [PAIR]: [] };
  server.clone = null;
  server.canAuthor = true;
  fetchMock.mockClear();
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
});

afterEach(cleanup);

/** The pathname + search the router is on, for the navigation pins. */
function Where() {
  const loc = useLocation();
  return <span data-testid="where">{`${loc.pathname}${loc.search}`}</span>;
}

/** The Studio's package route, the pillar keyed by package as the surface mounts it. */
function PackageRoute({ readOnlyIds }: { readOnlyIds: readonly string[] }) {
  const { pkg = '' } = useParams();
  return <AutomationsPillar key={pkg} packageId={pkg} readOnly={readOnlyIds.includes(pkg)} />;
}

function mount(packageId: string, readOnlyIds: readonly string[] = []) {
  render(
    <MemoryRouter initialEntries={[`/studio/${packageId}/automations`]}>
      <Routes>
        <Route path="/studio/:pkg/automations" element={<><PackageRoute readOnlyIds={readOnlyIds} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Open the ⋯ menu on the open flow. */
async function openMenu(): Promise<void> {
  expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval');
  fireEvent.pointerDown(await screen.findByTestId('auto-item-more'), { button: 0, ctrlKey: false });
}

/** Pick New similar: its dialog. */
async function openNewSimilar(): Promise<HTMLElement> {
  await openMenu();
  fireEvent.click(await screen.findByTestId('auto-item-new-similar'));
  return screen.findByTestId('auto-new-similar-dialog');
}

describe('Automations — New similar on a flow (#28567)', () => {
  it('on a read-only base sends no target, and opens the copy in the package the answer named, with its sentence as sent', async () => {
    server.clone = landedIn(PAIR);
    mount(BASE, [BASE]);
    await openMenu();
    // The base offers no Delete: its flows are the package's.
    expect(await screen.findByTestId('auto-item-new-similar')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-item-delete')).toBeNull();
    fireEvent.click(screen.getByTestId('auto-item-new-similar'));
    const dialog = await screen.findByTestId('auto-new-similar-dialog');
    // Both names mandatory, on a submittable default.
    expect(within(dialog).getByTestId('auto-new-similar-name')).toHaveValue('approval_copy');
    expect(within(dialog).getByTestId('auto-new-similar-label')).toHaveValue('Approval (copy)');

    server.flows[PAIR] = [{ name: 'approval_copy', label: 'Approval (copy)' }];
    fireEvent.click(within(dialog).getByTestId('auto-new-similar-submit'));

    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    expect(String(cloneCalls()[0][0])).toMatch(/\/automation\/approval\/clone$/);
    expect(cloneCalls()[0][1]?.method).toBe('POST');
    // EXACTLY the two members: no `package`, so the door picks the pair.
    expect(cloneBody()).toEqual({ name: 'approval_copy', label: 'Approval (copy)' });

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${PAIR}/automations?surface=flow%3Aapproval_copy`),
    );
    expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval (copy)');
    const strip = await screen.findByTestId('auto-new-similar-strip');
    expect(strip).toHaveTextContent(`Saved the copy approval_copy in package ${PAIR}.`);
    // The door's sentence, VERBATIM.
    expect(screen.getByTestId('auto-new-similar-notice').textContent).toBe(NOTICE);
    // No lineage (ADR-0126 §9): nothing names what the copy was made from.
    expect(strip).not.toHaveTextContent(/based on|copied from|Approval"/i);
    expect(screen.queryByTestId('auto-new-similar-dialog')).toBeNull();
  });

  it('on a writable package sends that package as the target, and opens the copy here after a re-read', async () => {
    server.clone = landedIn(WRITABLE);
    mount(WRITABLE);
    await openMenu();
    // CONTROL: a writable package's flow keeps its Delete beside New similar.
    expect(await screen.findByTestId('auto-item-delete')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('auto-item-new-similar'));
    const dialog = await screen.findByTestId('auto-new-similar-dialog');
    fireEvent.change(within(dialog).getByTestId('auto-new-similar-name'), { target: { value: 'approval_escalation' } });
    fireEvent.change(within(dialog).getByTestId('auto-new-similar-label'), { target: { value: 'Escalation approval' } });
    server.clone = {
      status: 200,
      body: { success: true, data: { flow: { ...FLOW, name: 'approval_escalation', label: 'Escalation approval' }, packageId: WRITABLE, notice: NOTICE } },
    };
    server.flows[WRITABLE] = [...server.flows[WRITABLE], { name: 'approval_escalation', label: 'Escalation approval' }];
    const listReads = mockClient.list.mock.calls.length;
    fireEvent.click(within(dialog).getByTestId('auto-new-similar-submit'));

    await waitFor(() => expect(cloneCalls()).toHaveLength(1));
    expect(cloneBody()).toEqual({ name: 'approval_escalation', label: 'Escalation approval', package: WRITABLE });
    await waitFor(() => expect(mockClient.list.mock.calls.length).toBeGreaterThan(listReads));
    await waitFor(() => expect(mockClient.layered.mock.calls.map(([, n]) => n)).toContain('approval_escalation'));
    expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${WRITABLE}/automations`);
    expect(await screen.findByTestId('auto-new-similar-strip')).toHaveTextContent(
      `Saved the copy approval_escalation in package ${WRITABLE}.`,
    );
    expect(screen.getByTestId('auto-new-similar-notice').textContent).toBe(NOTICE);
  });

  it('shows a 409 verbatim, keeps the dialog open on the names typed, and opens nothing', async () => {
    server.clone = { status: 409, body: { success: false, error: { code: 'RESOURCE_CONFLICT', message: TAKEN } } };
    mount(BASE, [BASE]);
    const dialog = await openNewSimilar();
    fireEvent.click(within(dialog).getByTestId('auto-new-similar-submit'));
    expect(await within(dialog).findByTestId('auto-new-similar-refusal')).toHaveTextContent(TAKEN);
    expect(within(dialog).getByTestId('auto-new-similar-refusal').textContent).toBe(TAKEN);
    expect(screen.getByTestId('auto-new-similar-dialog')).toBeInTheDocument();
    expect(within(dialog).getByTestId('auto-new-similar-name')).toHaveValue('approval_copy');
    expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${BASE}/automations`);
    expect(screen.queryByTestId('auto-new-similar-strip')).toBeNull();
  });

  it('shows any other refusal verbatim too (a 422 on the target)', async () => {
    const sentence = 'Package com.acme.app is read-only: a flow is written into a writable package.';
    server.clone = { status: 422, body: { success: false, error: { code: 'WRITABLE_PACKAGE_REQUIRED', message: sentence } } };
    mount(WRITABLE);
    const dialog = await openNewSimilar();
    fireEvent.click(within(dialog).getByTestId('auto-new-similar-submit'));
    expect((await within(dialog).findByTestId('auto-new-similar-refusal')).textContent).toBe(sentence);
  });

  it('an answer that names no package opens nothing and says so', async () => {
    server.clone = landedIn(undefined);
    mount(BASE, [BASE]);
    const dialog = await openNewSimilar();
    fireEvent.click(within(dialog).getByTestId('auto-new-similar-submit'));
    const strip = await screen.findByTestId('auto-new-similar-strip');
    expect(strip).toHaveTextContent('does not name the package it landed in, so nothing was opened');
    expect(screen.getByTestId('auto-new-similar-notice').textContent).toBe(NOTICE);
    expect(screen.getByTestId('where')).toHaveTextContent(`/studio/${BASE}/automations`);
    expect(screen.getByTestId('auto-canvas-caption')).toHaveTextContent('Approval');
  });

  it('without manage_metadata the item is disabled and says why, and nothing is sent', async () => {
    server.canAuthor = false;
    mount(BASE, [BASE]);
    await openMenu();
    const item = await screen.findByTestId('auto-item-new-similar');
    expect(item).toHaveAttribute('data-disabled');
    expect(item).toHaveAttribute('title', expect.stringContaining('manage_metadata'));
    fireEvent.click(item);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('auto-new-similar-dialog')).toBeNull();
    expect(cloneCalls()).toHaveLength(0);
  });

  it('the package-less scope draws no menu', async () => {
    mockClient.list.mockImplementation(async () => [{ name: 'approval', label: 'Approval' }]);
    try {
      render(
        <MemoryRouter initialEntries={['/studio/~org/automations']}>
          <AutomationsPillar packageId={null} />
        </MemoryRouter>,
      );
      expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval');
      expect(screen.queryByTestId('auto-item-more')).toBeNull();
    } finally {
      mockClient.list.mockImplementation(async (_type: string, opts?: { packageId?: string }) =>
        opts?.packageId ? server.flows[opts.packageId] ?? [] : [],
      );
    }
  });
});
