// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26705 — an edit the Data pillar holds unsent is unsaved work:
 * every departure that would drop it asks first.
 *
 * The autosave holds a Picklist added before it has an option
 * (objectui#11786). Before this card only Publish read that hold; leaving the
 * pillar, opening another object in the rail or reloading dropped the field
 * with no question. Now the surface folds the held edit into the guard a dirty
 * pillar already raises (the leave confirm, the shell's link guard and
 * `beforeunload`), and the rail asks before it opens another object.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape; the
 * field is added the way the pillar offers it (`dataPillarAddField`).
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
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

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

/** The object the header names: its api-name chip. */
async function openObjectIs(name: string): Promise<void> {
  await waitFor(
    () => expect(within(screen.getByTestId('data-object-header')).getByTestId('studio-item-api-name')).toHaveTextContent(name),
    { timeout: 8000 },
  );
}

async function openTask(): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  window.history.replaceState(null, '', `/studio/${PKG}/data`);
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await openObjectIs('acme_task');
}

/** The card's repro: add a Picklist "Priority" with no option yet; the autosave holds it. */
async function holdAPicklist(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
  await addFieldFromFormToolbar(undefined, { label: 'Priority', type: /^Picklist$/ });
  await screen.findByTestId('studio-held', undefined, { timeout: 8000 });
}

/** Whether a reload / tab close would be asked about. */
function reloadAsks(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

const pillarLink = (name: string) => within(screen.getByTestId('studio-pillar-nav')).getByRole('link', { name });
const railRow = (label: string) => within(screen.getByTestId('studio-rail-data')).getByRole('button', { name: label });

describe('a held Data field guards every departure (objectstack#26705)', () => {
  it('leaving the pillar asks; Cancel keeps the held field, OK leaves and clears the guard', async () => {
    await openTask();
    await holdAPicklist();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(pillarLink('Automations'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();
    expect(screen.getByTestId('studio-rail-data')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(pillarLink('Automations'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByTestId('studio-rail-automations');
    // The unmounted pillar took its hold back: nothing is asked any more.
    expect(reloadAsks()).toBe(false);
    fireEvent.click(pillarLink('Data'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('opening another object in the rail asks; Cancel keeps the held field, OK opens the other object', async () => {
    await openTask();
    await holdAPicklist();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(railRow('Note'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    await openObjectIs('acme_task');
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    // Re-picking the open object drops nothing, so it asks nothing.
    fireEvent.click(railRow('Task'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(railRow('Note'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await openObjectIs('acme_note');
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  it('a reload asks while the field is held', async () => {
    await openTask();
    expect(reloadAsks()).toBe(false);
    await holdAPicklist();
    expect(reloadAsks()).toBe(true);
  });

  // CONTROL: nothing held, nothing asked.
  it('with no edit held, the rail, the reload and the pillar link never ask', async () => {
    await openTask();

    fireEvent.click(railRow('Note'));
    await openObjectIs('acme_note');
    expect(reloadAsks()).toBe(false);
    fireEvent.click(pillarLink('Automations'));
    await screen.findByTestId('studio-rail-automations');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
