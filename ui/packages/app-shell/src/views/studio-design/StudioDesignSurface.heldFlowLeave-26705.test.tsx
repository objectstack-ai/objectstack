// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26705 — an edit the Automations pillar holds unsent is unsaved
 * work: every departure that would drop it asks first.
 *
 * The autosave holds a step added before its required inputs are filled
 * (objectui#11786). Before this card only Publish read that hold; leaving the
 * pillar, opening another flow in the rail or reloading dropped the step with
 * no question. Now the surface folds the held edit into the guard a dirty
 * pillar already raises (the leave confirm, the shell's link guard and
 * `beforeunload`), and the rail asks before it opens another flow.
 *
 * Rendered through the REAL `StudioDesignSurface` on the real route shape, with
 * the real registered `FlowPreview` / `FlowInspector`, as in
 * `StudioDesignSurface.heldPublish-11786.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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
  return { ...mod, useMetadataClient: () => mockClient, // objectstack#36899 — the registry serves the designer types the left menu lists.
    useMetadataTypes: () => ({
      entries: [
        { type: 'object', domain: 'data' },
        { type: 'flow', domain: 'automation' },
      ],
    }), };
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

// The source under test reaches a dynamic import of `@objectstack/lint`: its first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
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
    type === 'flow' ? Object.values(FLOWS).map((f) => ({ name: f.name, label: f.label, _packageId: PKG })) : [],
  );
  mockClient.layered.mockImplementation(async (type: string, name: string) => ({
    code: null,
    overlay: null,
    overlayScope: null,
    effective: type === 'flow' && FLOWS[name] ? JSON.parse(JSON.stringify(FLOWS[name])) : null,
  }));
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** The router's path, for the landing pins. */
function Where() {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}
const where = () => screen.getByTestId('where').textContent ?? '';

async function openFlow(): Promise<void> {
  // The shell's link guard reads the window's URL to skip a link to the page
  // already shown; `BrowserRouter` keeps the two equal, so this does too.
  // objectstack#36903 — the flow designer, full-screen on the flow's address.
  const at = `/studio/${PKG}/metadata/flow/approval?package=${PKG}`;
  window.history.replaceState(null, '', at);
  render(
    <MemoryRouter initialEntries={[at]}>
      <Where />
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
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

/** Whether a reload / tab close would be asked about. */
function reloadAsks(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** objectstack#36899 — the left menu's entry for a type: a link to that type's area list. */
const menuEntry = (type: string) => within(screen.getByTestId('studio-menu')).getByTestId(`studio-menu-entry-type:${type}`);

describe('a held flow step guards every departure (objectstack#26705)', () => {
  it('leaving the pillar through the menu asks; Cancel keeps the held step, OK leaves and clears the guard', async () => {
    await openFlow();
    await holdANotifyStep();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(menuEntry('object'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();
    expect(where()).toBe(`/studio/${PKG}/metadata/flow/approval`);

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(menuEntry('object'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(where()).toBe(`/studio/${PKG}/metadata/object`));
    // The unmounted pillar took its hold back: nothing is asked any more.
    expect(reloadAsks()).toBe(false);
  });

  // objectstack#36903 — another flow opens through ×, ‹ › or ⌘K (decision 7): × and ‹ › ask.
  it('× back to the list asks; Cancel keeps the held step, OK opens the list', async () => {
    await openFlow();
    await holdANotifyStep();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTitle('API name: approval')).toBeInTheDocument();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(where()).toBe(`/studio/${PKG}/metadata/flow`));
  });

  it('‹ › to the next flow asks; Cancel keeps the held step, OK opens the next flow', async () => {
    await openFlow();
    await holdANotifyStep();
    const next = await screen.findByTestId('studio-detail-next', undefined, { timeout: 8000 });
    await waitFor(() => expect(next).toBeEnabled(), { timeout: 8000 });

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(next);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle('API name: approval')).toBeInTheDocument();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(next);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByTitle('API name: reminder', undefined, { timeout: 8000 });
    expect(where()).toBe(`/studio/${PKG}/metadata/flow/reminder`);
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  it('a reload asks while the step is held', async () => {
    await openFlow();
    expect(reloadAsks()).toBe(false);
    await holdANotifyStep();
    expect(reloadAsks()).toBe(true);
  });

  // CONTROL: nothing held, nothing asked.
  it('with no edit held, ‹ ›, the reload and the menu link never ask', async () => {
    await openFlow();

    const next = await screen.findByTestId('studio-detail-next', undefined, { timeout: 8000 });
    await waitFor(() => expect(next).toBeEnabled(), { timeout: 8000 });
    fireEvent.click(next);
    await screen.findByTitle('API name: reminder', undefined, { timeout: 8000 });
    expect(reloadAsks()).toBe(false);
    fireEvent.click(menuEntry('object'));
    await waitFor(() => expect(where()).toBe(`/studio/${PKG}/metadata/object`));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
