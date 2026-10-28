// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26845 — the two departures objectstack#26705 left open, seen
 * from the Automations pillar: creating a flow, and a Pending changes request
 * while a step is held.
 *
 * New flow opens the created flow, whose load replaces the buffer the held
 * step lives in, so it asks before its dialog opens. A Pending changes request
 * names an object, which this pillar does not hold: it leaves the pillar
 * through the surface's leave guard, which asks once, and the Data pillar it
 * lands on holds nothing, so nothing asks a second time.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape, as
 * in `StudioDesignSurface.heldFlowLeave-26705.test.tsx`; the sheet is a stand-in
 * that asks the host for an object exactly as its security block does
 * (`useSurfaceNavigator`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';

const flowNamed = (name: string, label: string) => ({
  name,
  label,
  type: 'autolaunched',
  status: 'obsolete',
  _packageId: PKG,
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

const NOTE = { name: 'acme_note', label: 'Note', fields: [{ name: 'body', label: 'Body', type: 'text' }] };

const FLOWS: Record<string, ReturnType<typeof flowNamed>> = {
  approval: flowNamed('approval', 'Approval'),
  reminder: flowNamed('reminder', 'Reminder'),
};

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (_type: string) => [] as unknown[]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string) => ({ code: null, overlay: null, overlayScope: null, effective: null as unknown })),
  getDraft: vi.fn(async (type: string, name: string) => {
    throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
  }),
  save: vi.fn(async () => ({})),
  publishDraft: vi.fn(async () => ({ success: true })),
  publishPackageDrafts: vi.fn(async () => ({ success: true, failed: [] })),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }]),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
// Stands in for the Pending changes sheet: its security block asks the host to
// open the object a draft names, through the surface channel.
vi.mock('../../preview/DraftChangesPanel', async () => {
  const { createElement } = await import('react');
  const { useSurfaceNavigator } = await import('./surfaceDeepLinkChannel');
  return {
    DraftChangesPanel: () => {
      const openSurface = useSurfaceNavigator();
      return createElement(
        'button',
        { type: 'button', onClick: () => openSurface?.({ type: 'object', name: 'acme_note' }) },
        'Pending object/acme_note',
      );
    },
  };
});

import { StudioDesignSurface } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { FlowPreview } from '../metadata-admin/previews/FlowPreview';
import { FlowInspector } from '../metadata-admin/inspectors/FlowInspector';
import { browserClick } from '../metadata-admin/previews/__tests__/browserClick';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

registerMetadataPreview('flow', FlowPreview);
registerMetadataInspector('flow', FlowInspector);

// This jsdom environment ships no window.confirm — install a mock outright.
let confirmSpy: ReturnType<typeof vi.fn>;
const LEAVE_QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en');

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.list.mockImplementation(async (type: string) =>
    type === 'flow'
      ? Object.values(FLOWS).map((f) => ({ name: f.name, label: f.label, _packageId: PKG }))
      : type === 'object'
        ? [{ name: NOTE.name, label: NOTE.label, _packageId: PKG }]
        : [],
  );
  mockClient.layered.mockImplementation(async (type: string, name: string) => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective:
      type === 'flow' && FLOWS[name]
        ? JSON.parse(JSON.stringify(FLOWS[name]))
        : type === 'object' && name === NOTE.name
          ? JSON.parse(JSON.stringify(NOTE))
          : null,
  }));
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

async function openFlow(): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  window.history.replaceState(null, '', `/studio/${PKG}/automations`);
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByTitle('API name: approval', undefined, { timeout: 8000 });
}

/** Add a Notify step and leave its Title empty: the autosave holds it. */
async function holdANotifyStep(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Insert node here' }, { timeout: 8000 }));
  const option = screen.getAllByRole('option').find((o) => o.textContent?.startsWith('Notify'));
  browserClick(option!);
  await screen.findByTestId('studio-held', undefined, { timeout: 8000 });
}

const newFlow = () => fireEvent.click(within(screen.getByTestId('studio-rail-automations')).getByTestId('studio-rail-add'));
const pendingRequest = () => fireEvent.click(screen.getByRole('button', { name: 'Pending object/acme_note' }));

/** The Data pillar is open on the Pending changes request's object. */
async function noteIsOpen(): Promise<void> {
  await screen.findByTestId('studio-rail-data', undefined, { timeout: 8000 });
  await waitFor(
    () => expect(within(screen.getByTestId('data-object-header')).getByTestId('studio-item-api-name')).toHaveTextContent('acme_note'),
    { timeout: 8000 },
  );
}

describe('a held flow step guards create and Pending changes (objectstack#26845)', () => {
  it('New flow asks; Cancel opens no dialog and keeps the held step, OK opens the dialog', async () => {
    await openFlow();
    await holdANotifyStep();

    confirmSpy.mockReturnValueOnce(false);
    newFlow();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    newFlow();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByRole('dialog');
  });

  it("a Pending changes request for another pillar's item asks once; Cancel keeps the held step, OK opens it", async () => {
    await openFlow();
    await holdANotifyStep();

    confirmSpy.mockReturnValueOnce(false);
    pendingRequest();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('studio-rail-automations')).toBeInTheDocument();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    pendingRequest();
    await noteIsOpen();
    // The surface's leave guard asked; the Data pillar holds nothing, so the
    // request it applies on arrival asks nothing more.
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  // CONTROL: nothing held, nothing asked.
  it('with no edit held, New flow and a Pending changes request never ask', async () => {
    await openFlow();

    newFlow();
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    pendingRequest();
    await noteIsOpen();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
