// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27356 row 19 (maintainer-ruled A1) — Delete flow in the Automations
 * pillar's ⋯ menu, on a writable package's open flow: an in-app confirm
 * naming the flow (objectui#13333), the draft's discard and the flow's delete
 * at the package (`client.reset`), then the empty state over a re-read rail.
 * A refusal keeps the flow open; a read-only package draws no menu. The
 * harness is `AutomationsPillar.showMeFocus-26730`'s, the server doubled at
 * the metadata client.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { MemoryRouter } from 'react-router-dom';

const PKG = 'com.acme.app';

const FLOW = {
  name: 'approval',
  label: 'Approval',
  type: 'autolaunched',
  status: 'active',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const server = vi.hoisted(() => ({ draft: null as Record<string, unknown> | null, deleted: false, refuse: null as Error | null }));

const mockClient = vi.hoisted(() => ({
  // A second flow stays on the rail: the pillar must not open it after the delete.
  list: vi.fn(async () => [...(server.deleted ? [] : [{ name: 'approval', label: 'Approval' }]), { name: 'escalate', label: 'Escalate' }]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_t: string, name: string) => ({ code: null, overlay: null, effective: { ...FLOW, name, label: name === 'approval' ? 'Approval' : 'Escalate' }, lock: 'none' })),
  getDraft: vi.fn(async (type: string, name: string) => {
    if (server.draft) return { type, name, item: JSON.parse(JSON.stringify(server.draft)) };
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async (type: string, name: string, item: unknown) => ({ type, name, item })),
  reset: vi.fn(async (_type: string, _name: string, options: { state?: string } = {}) => {
    if (options.state === 'draft') server.draft = null;
    else if (server.refuse) throw server.refuse;
    else server.deleted = true;
    return {};
  }),
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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AutomationsPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();

// The pillar's `/automation/_status` probe: "absent", its documented fallback.
vi.stubGlobal('fetch', vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })));

beforeEach(() => {
  server.draft = null;
  server.deleted = false;
  server.refuse = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(cleanup);

function mount(readOnly = false) {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <AutomationsPillar packageId={PKG} readOnly={readOnly} />
    </MemoryRouter>,
  );
}

/** Open the ⋯ menu and pick Delete flow: the confirm dialog. */
async function openConfirm(): Promise<HTMLElement> {
  fireEvent.pointerDown(await screen.findByTestId('auto-item-more', undefined, { timeout: 8000 }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByTestId('auto-item-delete'));
  return screen.findByTestId('auto-delete-confirm-dialog');
}
const deleteFromMenu = async () => fireEvent.click(within(await openConfirm()).getByTestId('auto-delete-confirm-action'));

describe('Automations — Delete flow (#27356 row 19)', () => {
  it('asks naming the flow, discards its draft, deletes it at the package, and leaves the pillar on its empty state', async () => {
    server.draft = { ...FLOW, label: 'Approval' };
    mount();
    expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval');
    const listReads = mockClient.list.mock.calls.length;

    const dialog = await openConfirm();
    expect(dialog).toHaveTextContent('"Approval"');
    expect(dialog).toHaveTextContent('flow/approval');
    expect(mockClient.reset).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('auto-delete-confirm-action'));

    await waitFor(() => expect(mockClient.reset).toHaveBeenCalledTimes(2));
    expect(mockClient.reset.mock.calls).toEqual([
      ['flow', 'approval', { state: 'draft', packageId: PKG }],
      ['flow', 'approval', { packageId: PKG }],
    ]);
    await waitFor(() => expect(mockClient.list.mock.calls.length).toBeGreaterThan(listReads));
    await waitFor(() => expect(screen.queryByText('Approval')).toBeNull());
    expect(screen.getByText('Escalate')).toBeInTheDocument();
    expect(mockClient.layered.mock.calls.map(([, name]) => name)).not.toContain('escalate');
    expect(screen.queryByTestId('auto-canvas-caption')).toBeNull();
    expect(screen.queryByTestId('auto-item-more')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Deleted flow "Approval"');
  });

  it('a flow with no pending draft is deleted with the one call', async () => {
    mount();
    await deleteFromMenu();
    await waitFor(() => expect(screen.queryByTestId('auto-canvas-caption')).toBeNull());
    expect(mockClient.reset.mock.calls).toEqual([['flow', 'approval', { packageId: PKG }]]);
  });

  it('a refused delete shows the door\'s sentence and keeps the flow open', async () => {
    server.refuse = Object.assign(new Error('flow/approval is referenced by 2 triggers.'), { status: 409, code: 'RESOURCE_CONFLICT' });
    mount();
    await deleteFromMenu();
    expect(await screen.findByTestId('studio-refusal')).toHaveTextContent('flow/approval is referenced by 2 triggers.');
    expect(screen.getByTestId('auto-canvas-caption')).toHaveTextContent('Approval');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a read-only package draws no ⋯ menu', async () => {
    mount(true);
    expect(await screen.findByTestId('auto-canvas-caption', undefined, { timeout: 8000 })).toHaveTextContent('Approval');
    expect(screen.queryByTestId('auto-item-more')).toBeNull();
  });
});
