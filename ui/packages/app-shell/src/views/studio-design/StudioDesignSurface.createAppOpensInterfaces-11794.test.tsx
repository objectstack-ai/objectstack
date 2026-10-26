// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11794 — after *Create app*, Studio opens the Interfaces pillar, where
 * the new app lives, instead of leaving its author on the pillar the header
 * button was pressed from.
 *
 * Navigation only. The create's one write — `save('app', NAME, skeleton,
 * { mode: 'draft', packageId, ifNoneMatch: '*', surface: 'studio' })` — is pinned byte for byte
 * against `buildAppSkeleton`, so the card changes where the author lands and
 * nothing the server receives. (`ifNoneMatch` is objectui#11773's first-write
 * pin, which every create sends.)
 *
 * The departure goes through the surface's own leave guard, the one a pillar
 * link uses (objectui#2600): an unsent edit on the pillar being left asks
 * first, and "stay" keeps the author there with the app already created.
 *
 * Rendered through the real `StudioDesignSurface` + `AccessPillar` +
 * `PermissionMatrixEditPage` stack, as `pillarNavGuard` is, so the dirty report
 * crosses every real seam; only data I/O and heavy docks are doubled.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let clientImpl: ReturnType<typeof makeClient>;

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => clientImpl,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [{ id: 'app.a', name: 'App A', writable: true, namespace: 'a' }]),
  };
});

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { buildAppSkeleton } from './skeletons';

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

interface Server {
  /** Every `save` call, as the surface made it. */
  saves: Array<[string, string, unknown, unknown]>;
  /** The app draft a create left behind, which the Interfaces pillar then reads. */
  appDraft: { name: string; body: Record<string, unknown> } | null;
}

let server: Server;

function makeClient(s: Server) {
  return {
    list: vi.fn(async (type: string) => {
      if (type === 'permission') return [{ name: 'set_a', label: 'Set A' }];
      if (type === 'object') return [{ name: 'a_account' }];
      return [];
    }),
    listDrafts: vi.fn(async (opts?: { type?: string }) =>
      opts?.type === 'app' && s.appDraft ? [{ name: s.appDraft.name }] : [],
    ),
    layered: vi.fn(async (_type: string, name: string) => ({
      effective: name === 'set_a' ? { name: 'set_a', label: 'Set A', objects: { a_account: { allowRead: true } }, fields: {} } : null,
      code: null,
      overlay: null,
      overlayScope: null,
    })),
    getDraft: vi.fn(async (type: string, name: string) =>
      type === 'app' && s.appDraft?.name === name ? { type, name, item: s.appDraft.body } : null,
    ),
    get: vi.fn(async (type: string) => (type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null)),
    save: vi.fn(async (type: string, name: string, body: Record<string, unknown>, opts: unknown) => {
      s.saves.push([type, name, body, opts]);
      if (type === 'app') s.appDraft = { name, body };
      return body;
    }),
  };
}

let confirmSpy: ReturnType<typeof vi.fn>;
/** Every pathname the router has rendered, in order. */
let pathnames: string[];

function LocationProbe() {
  const { pathname } = useLocation();
  if (pathnames[pathnames.length - 1] !== pathname) pathnames.push(pathname);
  return null;
}

beforeEach(() => {
  server = { saves: [], appDraft: null };
  clientImpl = makeClient(server);
  pathnames = [];
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderOn(pillar: 'access' | 'interfaces') {
  render(
    <MemoryRouter initialEntries={[`/studio/app.a/${pillar}`]}>
      <LocationProbe />
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  // objectui#12725 — by test id: the Interfaces properties now sit in the right
  // slot beside the top bar, and testing-library reads their aside's `header`
  // as a second banner (a browser does not: it is inside an `aside`).
  const toolbar = await screen.findByTestId('studio-shell-header');
  await waitFor(() => expect(within(toolbar).getByRole('button', { name: 'Create app' })).toBeInTheDocument());
  if (pillar === 'access') await screen.findByText('a_account');
  return toolbar;
}

/** Create "Field Service" from the toolbar, through the real dialog. */
async function createApp(toolbar: HTMLElement) {
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Create app' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(dialog.querySelectorAll('input')[0], { target: { value: 'Field Service' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));
  await waitFor(() => expect(server.saves.filter(([type]) => type === 'app')).toHaveLength(1));
}

/** The one write, as it was before this card: the package's objects seeded into the nav. */
function expectTheCreateWriteUnchanged() {
  expect(server.saves).toEqual([
    [
      'app',
      'field_service',
      buildAppSkeleton('field_service', 'Field Service', [{ name: 'a_account' }]),
      { mode: 'draft', packageId: 'app.a', ifNoneMatch: '*', surface: 'studio' },
    ],
  ]);
}

/** Flip a matrix cell so the Access pillar reports an unsent edit. */
function dirtyTheMatrix() {
  const row = screen.getByText('a_account').closest('tr')!;
  // objectui#12456 — the bulk strip draws on the row under the pointer.
  fireEvent.mouseEnter(row);
  fireEvent.click(within(row).getByRole('button', { name: 'None' }));
}

describe('Create app opens the Interfaces pillar (objectui#11794)', () => {
  it('from another pillar, a clean create lands on Interfaces, which reads the new app; the write is unchanged', async () => {
    const toolbar = await renderOn('access');
    await createApp(toolbar);

    await waitFor(() => expect(pathnames[pathnames.length - 1]).toBe('/studio/app.a/interfaces'));
    expect(confirmSpy).not.toHaveBeenCalled();
    // The Interfaces pillar resolved the app the create left as a draft.
    await waitFor(() => expect(clientImpl.getDraft).toHaveBeenCalledWith('app', 'field_service', { packageId: 'app.a' }));
    expectTheCreateWriteUnchanged();
  });

  it('with an unsent edit on the pillar being left, it asks first; "stay" keeps the author there, app created', async () => {
    const toolbar = await renderOn('access');
    dirtyTheMatrix();
    confirmSpy.mockReturnValueOnce(false);
    await createApp(toolbar);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(pathnames).toEqual(['/studio/app.a/access']);
    // Still on Access, the edit still there.
    const row = screen.getByText('a_account').closest('tr')!;
    expect(within(row).getByRole('checkbox', { name: 'a_account Read' })).not.toBeChecked();
    expectTheCreateWriteUnchanged();
  });

  it('with an unsent edit, "leave" lands on Interfaces', async () => {
    const toolbar = await renderOn('access');
    dirtyTheMatrix();
    confirmSpy.mockReturnValueOnce(true);
    await createApp(toolbar);

    await waitFor(() => expect(pathnames[pathnames.length - 1]).toBe('/studio/app.a/interfaces'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expectTheCreateWriteUnchanged();
  });

  it('control: created from Interfaces itself, nothing navigates and nothing asks', async () => {
    const toolbar = await renderOn('interfaces');
    await createApp(toolbar);

    await waitFor(() => expect(clientImpl.getDraft).toHaveBeenCalledWith('app', 'field_service', { packageId: 'app.a' }));
    expect(pathnames).toEqual(['/studio/app.a/interfaces']);
    expect(confirmSpy).not.toHaveBeenCalled();
    expectTheCreateWriteUnchanged();
  });
});
