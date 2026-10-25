// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio header — unsaved-changes guard on SPA navigation (objectui#2600).
 *
 * The pillar links, the Home button and the PackageSwitcher are pure
 * react-router client navigation, so the editors' `beforeunload` guard never
 * fires; before this guard existed they unmounted a dirty pillar silently and
 * discarded its unsaved edits. Pillars now mirror their dirty state up to the
 * surface (same `onDirtyChange` contract as the Access rail guard, PR #2588),
 * and every header-driven departure gates on a native confirm:
 *
 *   • dirty + pillar switch → confirm; cancel keeps the pillar and its edits,
 *   • dirty + Home → same confirm; cancel stays, confirm leaves,
 *   • dirty + package switch → same confirm,
 *   • dirty OWD overview rows + pillar switch → same confirm (the pillar
 *     folds the overview's report into the same bit, objectui#2600 follow-up),
 *   • clean navigation never prompts,
 *   • re-clicking the open pillar never prompts (nothing unmounts),
 *   • a confirmed discard clears the guard (the pillar resets on unmount).
 *
 * objectui#13253 — a dirty pillar also registers with the shell's
 * unsaved-edits seam, so a shell departure (a header menu, the palette, the
 * inbox, the AI entry) asks too. The seam's capture-phase link guard now asks
 * before a pillar link leaves, so the pillar links ask once, not twice. The
 * window's URL is kept at the router's, as `BrowserRouter` keeps it, because
 * that guard reads the window's URL to skip a link to the page already shown.
 *
 * Rendered through the real StudioDesignSurface + AccessPillar +
 * PermissionMatrixEditPage stack (mocking only data I/O and heavy rail
 * siblings), so the dirty report crosses every real seam.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let clientImpl: any;

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

// The surface's package list (header switcher + writability gate) — two
// writable packages so the switcher has somewhere to go.
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [
      { id: 'app.a', name: 'App A', writable: true, namespace: 'a' },
      { id: 'app.b', name: 'App B', writable: true, namespace: 'b' },
    ]),
  };
});

// Rail siblings / docks that are irrelevant to the guard — keep the render
// light. (The OWD overview is NOT mocked: its dirty report is under test.)
vi.mock('../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => null,
}));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({
  AccessExplainPanel: () => null,
}));
vi.mock('./StudioAiCopilot', () => ({
  StudioChatDock: () => null,
}));
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: () => null,
}));

import { t } from '../metadata-admin/i18n';
import { StudioDesignSurface } from './StudioDesignSurface';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';

// jsdom has no matchMedia — useIsMobile / useIsWideViewport need a stub.
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as any;

// Radix Popover (PackageSwitcher) floats via floating-ui, which observes size.
(globalThis as any).ResizeObserver =
  (globalThis as any).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

interface Server {
  byName: Record<string, Record<string, unknown>>;
  saved: Array<Record<string, unknown>>;
}

function freshServer(): Server {
  return {
    saved: [],
    byName: {
      set_a: {
        name: 'set_a',
        label: 'Set A',
        objects: { a_account: { allowRead: true } },
        fields: {},
      },
    },
  };
}

function makeClient(server: Server) {
  return {
    // Serves the Access rail (list('permission')), the embedded matrix
    // (list('object') + object get), the header's app probe (list('app')),
    // and — after a pillar switch — the Interfaces pillar's app resolution.
    list: async (type: string) => {
      if (type === 'permission') {
        return Object.values(server.byName).map((s) => ({ name: s.name, label: s.label }));
      }
      if (type === 'object') return [{ name: 'a_account' }];
      return [];
    },
    listDrafts: async () => [],
    layered: async (_type: string, name: string) => ({
      effective: server.byName[name],
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    get: async (type: string) =>
      type === 'object' ? { fields: [{ name: 'name', label: 'Name' }] } : null,
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => {
      server.saved.push(payload);
      return payload;
    },
  } as any;
}

// This jsdom environment ships no window.confirm at all — install a mock
// outright rather than spying.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clientImpl = makeClient(freshServer());
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
  // The surface's pending-drafts counter polls over raw fetch — stub it flat.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

async function renderSurfaceOnAccess() {
  window.history.replaceState(null, '', '/studio/app.a/access');
  render(
    <MemoryRouter initialEntries={['/studio/app.a/access']}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/studio" element={<div data-testid="studio-landing-page" />} />
      </Routes>
    </MemoryRouter>,
  );
  // First set auto-selects; wait for its matrix row so the whole editor (not
  // just the breadcrumb) has loaded before a test flips a cell.
  await screen.findByText('a_account');
}


/** objectui#12452 — Access is a segment of the pillar nav (the More overflow
 *  that held it retired): click its real router Link. */
async function clickAccessInNav() {
  fireEvent.click(await within(screen.getByTestId('studio-pillar-nav')).findByRole('link', { name: 'Access' }));
}

/**
 * objectui#11862 — the rail shows each set's machine name as secondary text, so
 * an open set's name is on the page more than once. objectui#12456 — the open
 * set's api name is its item header's mono chip (the Delegated admin tab, kept
 * mounted, lists every set name too), so "the matrix shows set X" is asked of
 * that header alone.
 */
const inSetHeader = () => within(screen.getByTestId('access-item-header'));
// The header is re-queried on each retry: the pillar's own header stands in
// while no set is open, and the set's header replaces it once the page loads.
const findInSetHeader = (text: string) => waitFor(() => inSetHeader().getByText(text));

/** Swap the main panel to the (real) OWD overview and edit a row. */
async function dirtyTheOwdOverview() {
  fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));
  await screen.findByTestId('owd-internal-a_account');
  const owdPrivate = t('engine.studio.settings.sharingPrivate', 'en-US');
  fireEvent.keyDown(screen.getByTestId('owd-internal-a_account'), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: owdPrivate }));
  return owdPrivate;
}

/** Flip a cell in the open matrix so the editor reports dirty. */
function dirtyTheMatrix() {
  const row = screen.getByText('a_account').closest('tr')!;
  // objectui#12456 — the bulk strip draws on the row under the pointer.
  fireEvent.mouseEnter(row);
  fireEvent.click(within(row).getByRole('button', { name: 'None' }));
}

const matrixEditSurvived = () => {
  // Row "None" left Read unchecked — a remount would reload allowRead: true.
  const row = screen.getByText('a_account').closest('tr')!;
  expect(within(row).getByRole('checkbox', { name: 'a_account Read' })).not.toBeChecked();
};

describe('Studio header — unsaved pillar edits guard (#2600)', () => {
  it('asks before a pillar switch when dirty; cancel keeps the pillar and its edits', async () => {
    await renderSurfaceOnAccess();
    dirtyTheMatrix();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('link', { name: 'Interfaces' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(inSetHeader().getByText('set_a')).toBeInTheDocument();
    matrixEditSurvived();

    // Confirming the same switch discards and lands on the Interfaces pillar.
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('link', { name: 'Interfaces' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByText('This package has no app yet');
    expect(screen.queryByText('set_a')).not.toBeInTheDocument();

    // The discarded pillar reset the guard on unmount — walking back to
    // Access must NOT prompt again.
    await clickAccessInNav();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await findInSetHeader('set_a');
  });

  it('gates a pillar switch on dirty OWD overview rows (#2600 follow-up)', async () => {
    await renderSurfaceOnAccess();
    // Swap the main panel to the (real) OWD overview and edit a row so the
    // panel's dirty report crosses AccessPillar into the surface guard.
    fireEvent.click(screen.getByRole('button', { name: 'Record sharing (OWD)' }));
    await screen.findByTestId('owd-internal-a_account');
    // The dial is the shared Select (objectui#11865): open it and pick, as a user does.
    const owdPrivate = t('engine.studio.settings.sharingPrivate', 'en-US');
    fireEvent.keyDown(screen.getByTestId('owd-internal-a_account'), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    fireEvent.click(within(listbox).getByRole('option', { name: owdPrivate }));

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('link', { name: 'Interfaces' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // Still on the overview, edit intact.
    expect(screen.getByTestId('owd-internal-a_account').textContent).toBe(owdPrivate);

    // Confirming discards and leaves; the unmounting pillar resets the guard,
    // so walking back to Access must NOT prompt again.
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('link', { name: 'Interfaces' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await screen.findByText('This package has no app yet');

    await clickAccessInNav();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await findInSetHeader('set_a');
  });

  it('switches pillars without prompting when clean', async () => {
    await renderSurfaceOnAccess();

    fireEvent.click(screen.getByRole('link', { name: 'Interfaces' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await screen.findByText('This package has no app yet');
  });

  it('never prompts when re-clicking the open pillar (nothing unmounts)', async () => {
    await renderSurfaceOnAccess();
    dirtyTheMatrix();

    await clickAccessInNav();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(inSetHeader().getByText('set_a')).toBeInTheDocument();
    matrixEditSurvived();
  });

  it('gates the Studio home button; cancel stays, confirm returns to the Studio landing', async () => {
    await renderSurfaceOnAccess();
    dirtyTheMatrix();

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTitle('Studio home'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(inSetHeader().getByText('set_a')).toBeInTheDocument();
    matrixEditSurvived();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTitle('Studio home'));
    expect(await screen.findByTestId('studio-landing-page')).toBeInTheDocument();
  });

  it('gates a package switch; cancel keeps the edits in place', async () => {
    await renderSurfaceOnAccess();
    dirtyTheMatrix();

    // Open the switcher (its label resolves once fetchPackages lands).
    fireEvent.click(await screen.findByRole('button', { name: /App A/ }));
    const other = await screen.findByRole('button', { name: /App B/ });

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(other);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(inSetHeader().getByText('set_a')).toBeInTheDocument();
    matrixEditSurvived();

    // Confirming jumps to the other package (header re-labels; matrix reloads).
    fireEvent.click(await screen.findByRole('button', { name: /App A/ }));
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(await screen.findByRole('button', { name: /App B/ }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByTestId('studio-pkg-chip')).toHaveTextContent('App B'),
    );
  });

  it('never prompts a clean package switch', async () => {
    await renderSurfaceOnAccess();

    fireEvent.click(await screen.findByRole('button', { name: /App A/ }));
    fireEvent.click(await screen.findByRole('button', { name: /App B/ }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('studio-pkg-chip')).toHaveTextContent('App B'),
    );
  });
});

describe('a dirty pillar registers with the shell seam (objectui#13253)', () => {
  it('dirty OWD rows (only the surface registers them): a shell departure asks once; Cancel keeps the edit', async () => {
    await renderSurfaceOnAccess();
    const owdPrivate = await dirtyTheOwdOverview();

    confirmSpy.mockReturnValueOnce(false);
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(t('engine.edit.unsavedLeaveConfirm', 'en-US'));
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByTestId('owd-internal-a_account').textContent).toBe(owdPrivate);
  });

  it('a dirty matrix: a shell departure asks once, though the matrix and the surface both register', async () => {
    await renderSurfaceOnAccess();
    dirtyTheMatrix();

    confirmSpy.mockReturnValueOnce(true);
    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('CONTROL: a clean pillar registers nothing — a shell departure goes at once', async () => {
    await renderSurfaceOnAccess();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
