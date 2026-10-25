// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7881 — `fetchFullPackage` never read `res.ok`, so a failed package
 * lookup opened the management sheet on a `null` package, silently.
 *
 * The helper that backs `openManage` fetched `/api/v1/packages` and went
 * straight to `res.json()`. The platform answers a failed read in the ADR-0112
 * envelope — `{ success: false, error: { code, message } }` — and that envelope
 * PARSES CLEANLY through the reader below it: `root` becomes the error object,
 * which is neither an array nor carries `packages`, so the list fell to `[]`
 * and `.find()` to `null`. Nothing threw, so `openManage`'s `catch` — the one
 * that toasts `formatMetadataError` — never ran, and the two lines after it
 * still fired: `setManage(null)` then `setManageOpen(true)`.
 *
 * Net effect: an author clicking "Package info & settings" during an outage got
 * `manageOpen === true` over a null `pkg`. `PackageDetailSheet` renders `null`
 * for a null package, so the click did nothing and said nothing — no sheet, no
 * toast, no explanation — and left `manageOpen` stuck true with no rendered
 * sheet to close it. Third variant of the objectui#7368 family, after
 * objectui#7821 (PR #7879): not a lost toast and not an inverted decision, but
 * a failure laundered into a successful-looking EMPTY RESULT. An empty list is
 * a completely legitimate success answer, which is exactly why it must never be
 * the value a failure produces.
 *
 * ## The failure shapes these pins drive are MEASURED, not invented
 *
 * `GET /api/v1/packages` is served by the direct-mount registrar
 * (`@objectstack/rest` `package-routes.ts`), which mounts first in the
 * production stack and is pinned by `check:route-envelope` at zero hand-written
 * bodies — every failure leaves through the shared `sendError` /
 * `sendThrownError`. Reachable on THIS path: `401 UNAUTHENTICATED`,
 * `403 FORBIDDEN` (the `studio.access` / `setup.access` capability gate),
 * `503 SERVICE_UNAVAILABLE` (either half of the two-source merge refusing a
 * read it could not perform) and `500 INTERNAL_ERROR`. All four carry the one
 * shape asserted below, pinned wire-side by `package-envelope.conformance.test.ts`.
 * In the 5xx band the producer's prose is withheld and replaced by the generic
 * `Internal server error`, which is why `error.code` travels with the message.
 * The only other shape a browser can meet here is a NON-JSON error body (a
 * proxy's HTML 502/504) — driven by §4.
 *
 * ## Why there are negative controls
 *
 * ⭐ Pins 1-4 all go red with the fix reverted; §5 and §6 stay GREEN either way.
 * That is the load-bearing half: without them a fix that simply never opened
 * the sheet, or never reported anything, would satisfy every other assertion
 * here while breaking the affordance outright.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';
const START_PATH = `/studio/${PACKAGE_ID}/interfaces`;

const row = (id: string) => ({ id, name: id, writable: true, namespace: id.split('.')[1] });

/** The list read the switcher, the writability gate and the namespace lookup
 *  share. Held OPEN in every case here so the raw `fetch` mock below belongs to
 *  `fetchFullPackage` alone — it is the one under test. */
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
 * ⭐ The sheet is stubbed to render on `open` ALONE — deliberately, and it is
 * what makes the defect observable. The real `PackageDetailSheet` starts with
 * `if (!pkg) return null`, so "opened on a null package" and "not opened" look
 * identical from the DOM. This stub separates them: `data-managed-id` is empty
 * exactly when the surface opened the sheet over nothing.
 */
vi.mock('../metadata-admin/PackagesPage', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    PackageDetailSheet: ({
      pkg,
      open,
    }: {
      pkg: { manifest?: { id?: string } } | null;
      open: boolean;
    }) => (open ? <div data-testid="pkg-sheet" data-managed-id={pkg?.manifest?.id ?? ''} /> : null),
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

/** What `GET /api/v1/packages` answers on the SUCCESS path: `sendOk` wraps the
 *  handler's `{ packages, total }` as `{ success: true, data }`. */
const listOk = (packages: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { packages, total: packages.length } }),
});

/** The ADR-0112 failure envelope, as `sendError` / `sendThrownError` write it. */
const listFailure = (status: number, code: string, message: string) => ({
  ok: false,
  status,
  json: async () => ({ success: false, error: { code, message } }),
});

/** The response `fetchFullPackage` receives; each case installs its own. */
let lookupResponse: unknown = listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID } }]);

beforeEach(() => {
  fetchPackagesMock.mockReset();
  toastError.mockReset();
  lookupResponse = listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID } }]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      // `fetchPackages` is mocked above, so this URL is `fetchFullPackage`'s alone.
      if (String(input) === '/api/v1/packages') return lookupResponse;
      // The pending-drafts counter and the automation status probe.
      return { ok: true, status: 200, json: async () => [] };
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const trigger = () => screen.getByTestId('studio-pkg-chip');

/**
 * Drive it the way the author does — switcher trigger → "Package info &
 * settings" — so the ONLY difference between the cases below is what the
 * lookup answers.
 */
async function clickManage(): Promise<void> {
  fetchPackagesMock.mockResolvedValue([row(PACKAGE_ID)]);
  render(
    <MemoryRouter initialEntries={[START_PATH]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loaded'));
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByText('Package info & settings'));
}

/**
 * Wait until `openManage` has SETTLED, whichever way it goes: it either
 * reported (the fix) or opened the sheet (the defect). Both arms are
 * observable, so the assertions that follow are not racing a pending promise
 * and the red lands on the defect rather than on a timeout — the same shape
 * PR #7879's pins use.
 */
async function settled(): Promise<void> {
  await waitFor(() =>
    expect(toastError.mock.calls.length > 0 || screen.queryByTestId('pkg-sheet') !== null).toBe(true),
  );
}

/** The one shared sonner id — `fetchFullPackage` is this surface's FOURTH
 *  caller of `/api/v1/packages`, so one outage is one toast, not four. */
const toastId = () => (toastError.mock.calls[0]?.[1] as { id?: string } | undefined)?.id;

describe('Studio package lookup — a failed read is not an empty result (#7881)', () => {
  describe('§1 a 503 SERVICE_UNAVAILABLE envelope', () => {
    it('does NOT open the management sheet', async () => {
      lookupResponse = listFailure(503, 'SERVICE_UNAVAILABLE', 'Internal server error');
      await clickManage();
      await settled();

      // ⛔ Never `manageOpen` over a null package: the envelope parsed cleanly
      // and produced an empty list, which used to reach `setManageOpen(true)`.
      expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument();
    });

    it('reports it through this file\'s EXISTING objectui#7368 channel', async () => {
      lookupResponse = listFailure(503, 'SERVICE_UNAVAILABLE', 'Internal server error');
      await clickManage();
      await settled();

      // The 5xx band withholds the producer's prose, so the code is the only
      // discriminating word and travels with the generic message.
      expect(toastError).toHaveBeenCalled();
      expect(toastError.mock.calls[0][0]).toBe('Internal server error (SERVICE_UNAVAILABLE)');
      expect(toastId()).toBe('studio-package-list');
      // ⛔ One channel, not two: exactly one report for one failure.
      expect(toastError).toHaveBeenCalledTimes(1);
    });
  });

  describe('§2 a 403 FORBIDDEN envelope — the capability gate', () => {
    it('does not open the sheet, and the server\'s own sentence reaches the author', async () => {
      lookupResponse = listFailure(
        403,
        'FORBIDDEN',
        'Reading packages requires the `studio.access` or `setup.access` capability.',
      );
      await clickManage();
      await settled();

      expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument();
      expect(toastError.mock.calls[0][0]).toBe(
        'Reading packages requires the `studio.access` or `setup.access` capability. (FORBIDDEN)',
      );
      expect(toastId()).toBe('studio-package-list');
    });
  });

  describe('§3 a 401 UNAUTHENTICATED envelope — an expired session', () => {
    it('does not open the sheet', async () => {
      lookupResponse = listFailure(401, 'UNAUTHENTICATED', 'Authentication required');
      await clickManage();
      await settled();

      expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument();
      expect(toastError.mock.calls[0][0]).toBe('Authentication required (UNAUTHENTICATED)');
    });
  });

  describe('§4 a non-JSON error body — the second reachable shape', () => {
    it('names the status instead of a JSON syntax error, and does not open the sheet', async () => {
      // A proxy's HTML 502/504: `res.json()` rejects. The pre-fix code let that
      // rejection out of `fetchFullPackage`, so this arm was the ONE that
      // already reached the catch — reporting `Unexpected token <` at the
      // author. The tolerant read now names the status.
      lookupResponse = {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<html>\"... is not valid JSON");
        },
      };
      await clickManage();
      await settled();

      expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument();
      expect(toastError.mock.calls[0][0]).toBe('HTTP 502');
      expect(toastId()).toBe('studio-package-list');
    });
  });

  describe('§5 a SUCCESSFUL read whose list does not contain the package', () => {
    it('still does not open the sheet, and says why', async () => {
      // Deleted or uninstalled in another tab. Not a transport failure — the
      // read succeeded — so there is no caught error to format, and this is
      // the arm `res.ok` alone would not have covered.
      lookupResponse = listOk([]);
      await clickManage();
      await settled();

      expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument();
      expect(toastError.mock.calls[0][0]).toBe(
        `Package ${PACKAGE_ID} is not in the installed list — it may have been deleted or uninstalled elsewhere.`,
      );
      expect(toastId()).toBe('studio-package-list');
    });
  });

  /**
   * ⭐ The negative controls. These pass with the fix reverted, which is what
   * proves the pins above are not restating an existing assertion — and what
   * stops a "fix" that simply stops opening the sheet from passing this file.
   */
  describe('§6 negative control — a genuinely successful lookup', () => {
    it('opens the sheet on the REAL package, exactly as before', async () => {
      lookupResponse = listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID }, writable: true }]);
      await clickManage();

      const sheet = await screen.findByTestId('pkg-sheet');
      expect(sheet).toHaveAttribute('data-managed-id', PACKAGE_ID);
    });

    it('reports nothing — a success is not an outage', async () => {
      lookupResponse = listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID }, writable: true }]);
      await clickManage();

      await screen.findByTestId('pkg-sheet');
      expect(toastError).not.toHaveBeenCalled();
    });

    it('reads the BARE-ARRAY body the same endpoint also serves', async () => {
      // `root = data.data ?? data` — the reader accepts both the wrapped
      // envelope and a bare array, and neither shape is changed by this card.
      lookupResponse = {
        ok: true,
        status: 200,
        json: async () => [{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID } }],
      };
      await clickManage();

      expect(await screen.findByTestId('pkg-sheet')).toHaveAttribute('data-managed-id', PACKAGE_ID);
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
