// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7368 — the Studio top bar's package switcher swallowed the
 * package-list fetch failure.
 *
 * `PackageSwitcher` held the list as `PkgEntry[] | null` and caught the
 * `fetchPackages()` rejection into an empty block, so `null` meant BOTH "still
 * loading" and "the fetch failed". The trigger then rendered
 * `current?.name ?? packageId`, which collapses a THIRD situation into the same
 * pixels: a package whose producer declared no name at all (`parsePackages`
 * falls `name` back to the id, objectui#7254). All three printed the identical
 * raw reverse-domain id — `app.b2r4` — with no toast, no console line and no
 * retry, forever. The author could not tell whether to go fix the manifest or
 * to go retry, which is the whole defect: the `.catch`'s justification argues
 * for degrading, not for degrading SILENTLY.
 *
 * The ruling on the card: REPORT the failure and DISTINGUISH the states; ⛔ no
 * retry (nobody has decided how many times, with what backoff, or what to show
 * after giving up — and a retry DELAYS the moment the user sees the failure,
 * which is the wrong direction for this defect). And ⛔ never turn the `.catch`
 * into a `throw`: one 503 must not take the Studio top bar down.
 *
 * These pins therefore assert, in order:
 *   1. the three states are distinguishable from each other,
 *   2. while the id itself is still on screen in all three (it is the author's
 *      one diagnostic handle — swapping it for "Unknown package" would trade a
 *      diagnosable id for an uninformative phrase),
 *   3. the failure is reported once, not three times, and
 *   4. the top bar still renders and still navigates when the fetch fails.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';

// The package list is the system under test — every case installs its own
// resolution/rejection before rendering.
const fetchPackagesMock = vi.fn();
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchPackages: (...args: unknown[]) => fetchPackagesMock(...args) };
});

// The report channel. Captured rather than rendered so the pins can read both
// the message and the sonner id that collapses one outage into one toast.
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

beforeEach(() => {
  fetchPackagesMock.mockReset();
  toastError.mockReset();
  // The surface's pending-drafts counter polls over raw fetch — stub it flat.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSurface(tab = 'interfaces') {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/${tab}`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/home" element={<div data-testid="home-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The switcher trigger — found by its own stable title, not by its text
 *  (its text is exactly what all three states used to share). */
const trigger = () => screen.getByTestId('studio-pkg-chip');

/**
 * A package whose producer declared NO name: `parsePackages` falls `name` back
 * to the id, so the loaded row carries the id as its name. This is the state
 * the failed one used to be indistinguishable from.
 */
const NAMELESS_ROW = { id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'b2r4' };

describe('Studio top bar — package-list fetch failure is reported, not swallowed (#7368)', () => {
  it('LOADED, no declared name: the id stands alone — no failure marker, no toast', async () => {
    fetchPackagesMock.mockResolvedValue([NAMELESS_ROW]);
    renderSurface();

    await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loaded'));
    expect(trigger()).toHaveTextContent(PACKAGE_ID);
    expect(screen.queryByTestId('pkg-switcher-failed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pkg-switcher-loading')).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('FAILED: the same id, but marked as a failure and reported through the file\'s own posture', async () => {
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    renderSurface();

    await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'failed'));
    // The id is still there — it is the diagnostic handle, not the problem.
    expect(trigger()).toHaveTextContent(PACKAGE_ID);
    // …and it no longer stands alone.
    const badge = screen.getByTestId('pkg-switcher-failed');
    expect(badge).toHaveTextContent('Failed to load');
    expect(badge).toHaveAttribute('title', 'Service Unavailable');

    // Reported once, with the error's own message (formatMetadataError).
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toBe('Service Unavailable');
  });

  it('LOADING: distinguishable from failed while the fetch is still in flight', async () => {
    // A promise that never settles — the switcher stays in flight.
    fetchPackagesMock.mockReturnValue(new Promise(() => {}));
    renderSurface();

    await waitFor(() => expect(screen.getByTestId('pkg-switcher-loading')).toBeInTheDocument());
    expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loading');
    expect(trigger()).toHaveTextContent(PACKAGE_ID);
    expect(screen.queryByTestId('pkg-switcher-failed')).not.toBeInTheDocument();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('the three states print the SAME text and are still told apart (the card\'s claim)', async () => {
    const CASES = [
      {
        install: () => fetchPackagesMock.mockReturnValue(new Promise(() => {})),
        state: 'loading',
        marker: 'pkg-switcher-loading',
      },
      {
        install: () => fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable')),
        state: 'failed',
        marker: 'pkg-switcher-failed',
      },
      {
        install: () => fetchPackagesMock.mockResolvedValue([NAMELESS_ROW]),
        state: 'loaded',
        marker: null,
      },
    ] as const;

    const texts: string[] = [];
    for (const c of CASES) {
      fetchPackagesMock.mockReset();
      c.install();
      renderSurface();
      await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', c.state));
      texts.push(trigger().textContent ?? '');
      if (c.marker) {
        expect(screen.getByTestId(c.marker)).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId('pkg-switcher-loading')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pkg-switcher-failed')).not.toBeInTheDocument();
      }
      cleanup();
    }

    // The trap, restated as an assertion: the id-bearing text is IDENTICAL
    // across loading and loaded, and the failed one only ADDS its marker to
    // that same string. Nothing in the text separates the three…
    expect(texts[0]).toBe(texts[2]);
    expect(texts[1].startsWith(texts[0])).toBe(true);
    for (const text of texts) expect(text).toContain(PACKAGE_ID);
    // …so the separation has to come from the state each case just asserted.
  });

  it('the popover says WHY instead of reading "Loading…" forever', async () => {
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    renderSurface();

    await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'failed'));
    fireEvent.click(trigger());

    const detail = await screen.findByTestId('pkg-switcher-failed-detail');
    expect(detail).toHaveTextContent('Service Unavailable');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('DEGRADES, never throws: the top bar still renders and still navigates', async () => {
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    renderSurface();

    await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'failed'));
    // The rest of the header survived the failure.
    expect(screen.getByRole('link', { name: 'Interfaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publish/ })).toBeInTheDocument();
    // …and the switcher is still a working trigger, not a dead label.
    fireEvent.click(trigger());
    expect(await screen.findByText('Packages (apps)')).toBeInTheDocument();
  });

  it('one outage is one toast: every call site reports on the same sonner id', async () => {
    // The `data` tab mounts all three `fetchPackages()` callers at once — the
    // switcher list, the writability courtesy gate and the namespace lookup.
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    renderSurface('data');

    await waitFor(() => expect(fetchPackagesMock.mock.calls.length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(toastError.mock.calls.length).toBeGreaterThanOrEqual(3));

    // Sonner collapses same-id toasts into one, so three rejections of one
    // endpoint surface as a single message rather than a stack of three.
    const ids = toastError.mock.calls.map((c) => (c[1] as { id?: string } | undefined)?.id);
    expect(new Set(ids)).toEqual(new Set(['studio-package-list']));
  });
});
