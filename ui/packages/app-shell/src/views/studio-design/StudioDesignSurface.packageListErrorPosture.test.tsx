// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7368 — a package-list fetch failure in Studio is reported, never
 * swallowed, and never takes the top bar down.
 *
 * The card's other half was the top bar's package switcher, which printed
 * the same raw id for "loading", "failed" and "declares no name"; it pinned
 * the switcher telling those three apart. objectstack#36501 removed the
 * switcher (the bar's left end is 「‹ Back to app」), so what stays pinned
 * here is the surface's own posture:
 *   1. the top bar still renders and its way out still navigates when the
 *      fetch fails (⛔ never a `throw`: one 503 must not take it down), and
 *   2. the failure is reported once, not once per caller: every caller
 *      reports on the same sonner id.
 */

import '@testing-library/jest-dom/vitest';
// The surface's reach loads `@objectstack/lint` lazily; pay that load during
// collection, not inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';
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

describe('Studio top bar — package-list fetch failure is reported, not swallowed (#7368)', () => {
  it('DEGRADES, never throws: the top bar still renders and still navigates', async () => {
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    renderSurface();

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    // The rest of the header survived the failure.
    expect(screen.getByRole('link', { name: 'Interfaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Publish/ })).toBeInTheDocument();
    // …and its way out still works (objectstack#36501): no app is known, so
    // it goes to the console's landing.
    fireEvent.click(screen.getByTestId('studio-back-to-app'));
    expect(await screen.findByTestId('home-page')).toBeInTheDocument();
  });

  it('one outage is one toast: every call site reports on the same sonner id', async () => {
    // The `data` tab mounts both `fetchPackages()` callers at once — the
    // writability courtesy gate and the namespace lookup.
    fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
    renderSurface('data');

    await waitFor(() => expect(fetchPackagesMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(toastError.mock.calls.length).toBeGreaterThanOrEqual(2));

    // Sonner collapses same-id toasts into one, so the rejections of one
    // endpoint surface as a single message rather than a stack.
    const ids = toastError.mock.calls.map((c) => (c[1] as { id?: string } | undefined)?.id);
    expect(new Set(ids)).toEqual(new Set(['studio-package-list']));
  });
});
