// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7821 — `onManageChanged` read a FAILED package-list refresh as
 * "the package was deleted" and evicted the author out of the Studio.
 *
 * The callback runs after every package lifecycle action fired from the
 * `PackageDetailSheet` (disable / duplicate / delete / publish / manifest
 * edit). It refreshed the list into a LOCAL `list`, initialised to `[]`, and
 * swallowed the rejection under a comment reading "keep the stale list" —
 * true of the `pkgs` state, which is simply not written, and false of the
 * local, which stayed `[]`. Three lines later `!list.some((p) => p.id ===
 * managedId)` was therefore UNCONDITIONALLY true after a failure, so the code
 * took the branch labelled `// Deleted`; when the managed package was the one
 * under the editor it navigated away, and `list[0]` being `undefined` made
 * the destination `/home`.
 *
 * Net effect: one transient `GET /api/v1/packages` failure — a 503 from the
 * durable half, a network blip, an auth expiry — threw the author out of the
 * editor, with no toast and no confirmation, while the package was still
 * there. That is the sibling defect of objectui#7368 escalated: not a
 * swallowed failure, but a swallowed failure that then decides the OPPOSITE
 * of the truth.
 *
 * These pins are behavioural, and there are three of them because the fix has
 * two ways to be wrong:
 *   1. a FAILED refresh causes NO navigation (the defect), and
 *   2. it is still REPORTED, through this file's existing objectui#7368
 *      posture (`formatMetadataError` on the shared sonner id, recorded so
 *      the trigger reads `failed`) — a fix must not buy pin 1 with silence;
 *   3. a REAL deletion — the list comes back successfully WITHOUT the package
 *      — still navigates. ⛔ Not optional: pinning only 1 and 2 lets the fix
 *      degrade into "never navigate", which strands the author on a package
 *      that no longer exists.
 *
 * Where a REAL deletion lands while other packages remain changed with
 * objectui#11784 (triage comment 6041966855: "return to `/studio` after a
 * delete"): the Studio landing. It used to open `list[0]`, whichever package
 * the list started with, so a delete read as "Studio moved me into another
 * app". The "sibling survives" case says the new destination; every other case
 * here is unchanged and stays as a control, the two "nothing left" cases
 * included (that arm is still objectui#7373's declared home).
 *
 * ⛔ The `.catch` is deliberately still a `.catch` (one 503 must not take the
 * Studio down — objectui#7368's ruling) and there is deliberately still no
 * retry (count / backoff / what-after-giving-up are unruled policy).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';

const PACKAGE_ID = 'app.b2r4';
const SIBLING_ID = 'app.other';
const START_PATH = `/studio/${PACKAGE_ID}/interfaces`;

const row = (id: string) => ({ id, name: id, writable: true, namespace: id.split('.')[1] });

// The package list refresh is the system under test — every case installs its
// own resolution/rejection for the refresh that `onManageChanged` performs.
const fetchPackagesMock = vi.fn();
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchPackages: (...args: unknown[]) => fetchPackagesMock(...args) };
});

// The report channel (objectui#7368's posture). Captured rather than rendered
// so a pin can read both the message and the shared sonner id.
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

/**
 * The lifecycle sheet, stubbed down to the one thing this file is about: the
 * `onChanged` callback it fires after a lifecycle action. Driving the real
 * sheet's delete/disable/publish buttons would test THOSE, and the defect is
 * in the surface's reaction, which every one of them reaches the same way.
 */
vi.mock('../metadata-admin/PackagesPage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PackageDetailSheet: ({
      pkg,
      open,
      onChanged,
    }: {
      pkg: { manifest?: { id?: string } } | null;
      open: boolean;
      onChanged: () => void | Promise<void>;
    }) =>
      open ? (
        <div data-testid="pkg-sheet" data-managed-id={pkg?.manifest?.id ?? ''}>
          <button type="button" data-testid="lifecycle-ran" onClick={() => void onChanged()}>
            a lifecycle action ran
          </button>
        </div>
      ) : null,
  };
});

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (_t: string, name: string) => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  save: vi.fn(async () => ({})),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});

// Rail siblings / docks irrelevant to the top bar — keep the render light.
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';

// jsdom ships neither of these; useIsMobile / useIsWideViewport and the Radix
// popover's floating-ui measurement need them.
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
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

/** Raw-`fetch` calls to the bare packages endpoint — that is `fetchFullPackage`,
 *  the managed-snapshot refresh `onManageChanged` performs AFTER the
 *  deletion decision. Counting it gives the negative pin a positive event to
 *  wait for: the callback provably ran past the branch that used to navigate. */
let snapshotFetches = 0;

beforeEach(() => {
  fetchPackagesMock.mockReset();
  toastError.mockReset();
  snapshotFetches = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === '/api/v1/packages') {
        snapshotFetches += 1;
        // What `fetchFullPackage` reads: the full installed record.
        return { ok: true, json: async () => [{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID } }] };
      }
      // The pending-drafts counter and the automation status probe.
      return { ok: true, json: async () => [] };
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/**
 * The app list the eviction's destination resolves against (objectui#7373).
 * `undefined` mounts the surface with no metadata context — every case written
 * before that card, for which `useHomePath()` answers the launcher.
 */
function withMetadata(
  apps: MetadataContextValue['apps'] | undefined,
  children: React.ReactNode,
) {
  if (!apps) return <>{children}</>;
  const value: MetadataContextValue = {
    apps,
    objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem: async () => null, getItemsByType: () => [], getTypeStatus: () => 'ready',
  };
  return <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>;
}

function renderSurface(apps?: MetadataContextValue['apps']) {
  return render(
    <MemoryRouter initialEntries={[START_PATH]}>
      <LocationProbe />
      {withMetadata(
        apps,
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
          <Route path="/studio" element={<div data-testid="studio-landing" />} />
          <Route path="/home" element={<div data-testid="home-page" />} />
          <Route path="/apps/cloud_control" element={<div data-testid="declared-landing" />} />
        </Routes>,
      )}
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByTestId('studio-pkg-chip');
const where = () => screen.getByTestId('location').textContent;

/**
 * Open the lifecycle sheet the way the author does — switcher trigger →
 * "Package info & settings" — and hand back its "a lifecycle action ran"
 * button. Every case shares this drive, so the ONLY difference between the
 * pins below is what the refresh does.
 */
async function openLifecycleSheet(
  initial = [row(PACKAGE_ID)],
  apps?: MetadataContextValue['apps'],
): Promise<HTMLElement> {
  fetchPackagesMock.mockResolvedValue(initial);
  renderSurface(apps);
  await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loaded'));
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByText('Package info & settings'));
  const sheet = await screen.findByTestId('pkg-sheet');
  expect(sheet).toHaveAttribute('data-managed-id', PACKAGE_ID);
  toastError.mockReset();
  return screen.getByTestId('lifecycle-ran');
}

describe('Studio package lifecycle — a failed refresh is not a deletion (#7821)', () => {
  it('FAILED refresh: the author is NOT evicted — no navigation at all', async () => {
    const lifecycle = await openLifecycleSheet();
    const before = snapshotFetches;

    // The refresh that follows the lifecycle action rejects.
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    fireEvent.click(lifecycle);

    // Wait until the callback has SETTLED, whichever way it goes: either it
    // navigated (the defect — the `/home` route mounts) or it went on to
    // refresh the managed snapshot (what follows the deletion decision). Both
    // arms are observable, so the assertions below are not racing a pending
    // navigation, and the red lands on the eviction itself rather than on a
    // timeout.
    await waitFor(() =>
      expect(snapshotFetches > before || screen.queryByTestId('home-page') !== null).toBe(true),
    );

    expect(where()).toBe(START_PATH);
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
    // Still in the editor, still on the same package.
    expect(trigger()).toHaveTextContent(PACKAGE_ID);
  });

  it('FAILED refresh: the failure is still REPORTED through this file\'s own posture', async () => {
    const lifecycle = await openLifecycleSheet();

    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    fireEvent.click(lifecycle);

    // objectui#7368's channel, reused: the error's own message, on the one
    // shared sonner id, so an outage that rejects several call sites is one
    // toast rather than a stack.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toBe('Service Unavailable');
    expect((toastError.mock.calls[0][1] as { id?: string } | undefined)?.id).toBe('studio-package-list');

    // …and recorded, so the switcher stops presenting the now-stale list as
    // though it were current.
    await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'failed'));
    // ⛔ Never a throw: the top bar is still a working trigger.
    fireEvent.click(trigger());
    expect(await screen.findByText('Packages (apps)')).toBeInTheDocument();
  });

  it('REAL deletion, nothing left: still navigates to /home (behaviour unchanged)', async () => {
    const lifecycle = await openLifecycleSheet();

    // The list came back — successfully — and the package is gone from it.
    fetchPackagesMock.mockResolvedValue([]);
    fireEvent.click(lifecycle);

    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
    expect(where()).toBe('/home');
    // A successful refresh is not a failure: nothing was reported.
    expect(toastError).not.toHaveBeenCalled();
  });

  it('REAL deletion, nothing left, a DECLARED landing: evicts to it, not to the launcher (objectui#7373)', async () => {
    // Same eviction as the case above — the only difference is that this
    // deployment declares where home is. Pre-#7373 the destination was the
    // `/home` literal either way, which on a control plane drops the author
    // into the environment launcher.
    const lifecycle = await openLifecycleSheet([row(PACKAGE_ID)], [
      { name: 'cloud_control', label: 'Cloud', isDefault: true },
      { name: 'account', label: 'Account' },
    ]);

    fetchPackagesMock.mockResolvedValue([]);
    fireEvent.click(lifecycle);

    expect(await screen.findByTestId('declared-landing')).toBeInTheDocument();
    expect(where()).toBe('/apps/cloud_control');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('REAL deletion, a sibling survives: returns to the Studio landing, not into the sibling (objectui#11784)', async () => {
    // The card's measured complaint: after the delete, Studio landed on
    // another package (showcase), the list's first entry, instead of the
    // Studio landing. Triage 6041966855: "return to `/studio` after a delete".
    const lifecycle = await openLifecycleSheet([row(PACKAGE_ID), row(SIBLING_ID)]);

    fetchPackagesMock.mockResolvedValue([row(SIBLING_ID)]);
    fireEvent.click(lifecycle);

    expect(await screen.findByTestId('studio-landing')).toBeInTheDocument();
    expect(where()).toBe('/studio');
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
  });

  it('successful refresh, package still there: no navigation, and an earlier failure clears', async () => {
    const lifecycle = await openLifecycleSheet();

    fetchPackagesMock.mockResolvedValue([row(PACKAGE_ID)]);
    const before = snapshotFetches;
    fireEvent.click(lifecycle);

    await waitFor(() => expect(snapshotFetches).toBeGreaterThan(before));
    expect(where()).toBe(START_PATH);
    expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loaded');
  });
});
