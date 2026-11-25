// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26845 — the two departures objectstack#26705 left open in the
 * Data pillar: creating an object, and opening another object from the
 * Pending changes sheet. Both load another object into the one buffer a held
 * edit lives in, so both ask the shared departure question first.
 *
 * New object asks before its dialog opens, so Cancel costs nothing and the
 * create itself asks nothing. A Pending changes request for another object
 * asks before the pillar applies it; one for the open object drops nothing
 * and asks nothing.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape, as
 * in `StudioDesignSurface.heldDataLeave-26705.test.tsx`; the sheet is a stand-in
 * that asks the host for an object exactly as its security block does
 * (`useSurfaceNavigator`).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';

const OBJECTS: Record<string, Record<string, unknown>> = {
  acme_task: { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] },
  acme_note: { name: 'acme_note', label: 'Note', fields: [{ name: 'body', label: 'Body', type: 'text' }] },
};

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (_type: string) => [] as unknown[]),
  listDrafts: vi.fn(async () => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  get: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async (_type: string, _name: string) => ({ code: null, overlay: null, overlayScope: null, effective: null as unknown })),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({ success: true })),
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
        'div',
        null,
        ['acme_task', 'acme_note'].map((name) =>
          createElement(
            'button',
            { key: name, type: 'button', onClick: () => openSurface?.({ type: 'object', name }) },
            `Pending object/${name}`,
          ),
        ),
      );
    },
  };
});

// The source under test reaches a dynamic import of `@objectstack/lint`: its first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import '@object-ui/plugin-detail';
import { StudioDesignSurface } from './StudioDesignSurface';
import { addFieldFromFormToolbar } from './__tests__/dataPillarAddField';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { t } from '../metadata-admin/i18n';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

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

// This jsdom environment ships no window.confirm — install a mock outright.
let confirmSpy: ReturnType<typeof vi.fn>;
const LEAVE_QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en');

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.list.mockImplementation(async (type: string) =>
    type === 'object' ? Object.values(OBJECTS).map((o) => ({ name: o.name, label: o.label, _packageId: PKG })) : [],
  );
  mockClient.layered.mockImplementation(async (type: string, name: string) => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: type === 'object' && OBJECTS[name] ? JSON.parse(JSON.stringify(OBJECTS[name])) : null,
  }));
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** The object the header names: its machine name beside the label (objectstack#36904). */
async function openObjectIs(name: string): Promise<void> {
  await waitFor(
    () => expect(within(screen.getByTestId('data-object-header')).getAllByTestId('studio-item-api-name')[0]).toHaveTextContent(name),
    { timeout: 8000 },
  );
}

async function openTask(): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  // objectstack#36904 — the object designer is the object's address.
  const at = `/studio/${PKG}/metadata/object/acme_task?package=${PKG}`;
  window.history.replaceState(null, '', at);
  render(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await openObjectIs('acme_task');
}

/** The card's repro: add a Picklist "Priority" with no option yet; the autosave holds it. */
async function holdAPicklist(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Field layout' }));
  await addFieldFromFormToolbar(undefined, { label: 'Priority', type: /^Picklist$/ });
  await screen.findByTestId('studio-held', undefined, { timeout: 8000 });
}

const pendingRequest = (name: string) => fireEvent.click(screen.getByRole('button', { name: `Pending object/${name}` }));

// objectstack#36904 — the designer has no 「新建」 (the object list's dialog is the
// create), so what is left to guard here is the Pending changes request, which
// now opens the object's own address.
describe('a held Data field guards Pending changes (objectstack#26845)', () => {
  it('a Pending changes request for another object asks; Cancel keeps the held field, OK opens the object', async () => {
    await openTask();
    await holdAPicklist();

    confirmSpy.mockReturnValueOnce(false);
    pendingRequest('acme_note');
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    await openObjectIs('acme_task');
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    // A request for the open object drops nothing, so it asks nothing.
    pendingRequest('acme_task');
    await openObjectIs('acme_task');
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValueOnce(true);
    pendingRequest('acme_note');
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2));
    await openObjectIs('acme_note');
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  // CONTROL: nothing held, nothing asked.
  it('with no edit held, a Pending changes request never asks', async () => {
    await openTask();

    pendingRequest('acme_note');
    await openObjectIs('acme_note');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
