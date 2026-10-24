// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7907 — the TAIL of `onManageChanged` swallowed a failed
 * managed-snapshot refresh, so after a lifecycle action the open sheet
 * presented the PRE-ACTION record as current.
 *
 * `onManageChanged` runs after every lifecycle action fired from the
 * `PackageDetailSheet` (disable / enable / duplicate / publish /
 * publish-drafts / manifest edit). It has two halves: the HEAD refreshes the
 * package LIST (objectui#7821, fixed in PR #7879) and the TAIL re-reads the
 * managed record so the edit shows immediately. The tail was:
 *
 *     try {
 *       const fresh = await fetchFullPackage(managedId);
 *       if (fresh) setManage(fresh);
 *     } catch {
 *       // keep the current snapshot
 *     }
 *
 * — true of what it did, and the reason it was wrong. The record in `manage`
 * is ALREADY known to be out of date at that point: the action the author just
 * fired is what changed it. So "keep the current snapshot" keeps a snapshot
 * whose staleness is established, says nothing about it, and leaves the author
 * reading `Status: Enabled` on a package they just disabled.
 *
 * ## ⚠️ objectui#7881 did not introduce this — it made it swallow MORE
 *
 * Before objectui#7881 (PR #7906) `fetchFullPackage` never read `res.ok`, so
 * this `catch` could only ever see a `res.json()` rejection — a non-JSON body.
 * Now that the helper refuses a non-2xx, the SAME catch also swallows every
 * 401 / 403 / 503 / 500 the endpoint serves. This is the general shape worth
 * naming: fixing one swallowed-error site makes the next swallowing site
 * downstream of it swallow more. A pre-existing defect made much easier to
 * hit, ⛔ not a regression.
 *
 * ## The failure shapes below are MEASURED on THIS arm
 *
 * The tail reads `fetchFullPackage`, i.e. `GET /api/v1/packages`, served by
 * the direct-mount registrar (`@objectstack/rest` `package-routes.ts`). Its
 * list handler has no hand-written body: the success leaves through `sendOk`
 * and every failure through `sendError` / `sendThrownError`, which write
 * `{ success: false, error: { code, message, ...optional } }`. Reachable
 * without a query string (this call sends none, so the `VALIDATION_ERROR` 400
 * of the sibling `:id` routes is not on this path): `401 UNAUTHENTICATED`
 * (the anonymous floor), `403 FORBIDDEN` (the `studio.access` / `setup.access`
 * capability gate), `503 SERVICE_UNAVAILABLE` (either half of the two-source
 * merge refusing a read it could not perform) and `500 INTERNAL_ERROR`, whose
 * prose the door withholds in favour of the generic sentence — which is why
 * `error.code` travels with the message.
 *
 * Two shapes exist here that are NOT that envelope, and both are driven below:
 * a non-JSON error body (a proxy's HTML 502/504 — §3) and a `fetch` that
 * rejects outright, with no response at all (offline / DNS / connection reset
 * — §4). And one non-failure that produced the same silence: a SUCCESSFUL read
 * whose list no longer contains the package (§5) — `fresh === null`, which the
 * old `if (fresh)` dropped just as quietly as the catch dropped a throw.
 *
 * ## What the fix does, and why the sheet CLOSES
 *
 * `PackageDetailSheet` is an ACTION surface, and it derives its verb from the
 * record it holds: `enabled = pkg.enabled !== false && pkg.status !==
 * 'disabled'` picks the button's label AND the endpoint it POSTs
 * (`.../${enabled ? 'disable' : 'enable'}`, `PackagesPage.tsx`). Left open on
 * a snapshot known to be pre-action it does not merely show a stale badge — it
 * re-arms the author with the verb they just fired. It is still a DEGRADATION
 * and not a throw (objectui#7368: one 503 must not take the Studio down): the
 * editor, the top bar and the list all stay, and reopening the sheet re-runs
 * the same read one click away.
 *
 * ## ⭐ Why there are negative controls
 *
 * §6 must stay GREEN with the fix reverted — that is what proves the pins
 * above are not restating an existing assertion, and it is what a DEGENERATE
 * "just close the sheet" fix cannot pass: closing unconditionally breaks the
 * successful refresh (§6.1/§6.2), and closing without reporting fails every
 * report pin (§1-§5). Both non-fixes are excluded from opposite sides.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';
const START_PATH = `/studio/${PACKAGE_ID}/interfaces`;

const row = (id: string) => ({ id, name: id, writable: true, namespace: id.split('.')[1] });

/** The record the sheet is opened on — BEFORE the lifecycle action. */
const preAction = {
  manifest: { id: PACKAGE_ID, name: PACKAGE_ID },
  status: 'active',
  enabled: true,
};

/** What a successful refresh brings back AFTER a disable. */
const postAction = {
  manifest: { id: PACKAGE_ID, name: PACKAGE_ID },
  status: 'disabled',
  enabled: false,
};

/** The package LIST read — the HEAD of `onManageChanged`, and the mount
 *  effect. Held open here so the raw `fetch` mock below belongs to
 *  `fetchFullPackage` alone: the tail is what is under test. */
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
 * ⭐ The sheet is stubbed to render on `open` alone AND to expose the record's
 * own lifecycle fields. Both halves are load-bearing: the real sheet returns
 * `null` for a null `pkg`, so without the first "open over nothing" and
 * "closed" look identical; and without `data-managed-status` a pin cannot tell
 * a refreshed record from the PRE-ACTION one — which is the entire defect.
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
      pkg: { manifest?: { id?: string }; status?: string; enabled?: boolean } | null;
      open: boolean;
      onChanged: () => void | Promise<void>;
    }) =>
      open ? (
        <div
          data-testid="pkg-sheet"
          data-managed-id={pkg?.manifest?.id ?? ''}
          data-managed-status={pkg?.status ?? ''}
          data-managed-enabled={String(pkg?.enabled ?? '')}
        >
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

/** What the SNAPSHOT read answers — reassigned per case after the sheet is
 *  open, so the sheet always opens on `preAction` and only the refresh differs.
 *  A thrown value here stands for a `fetch` that rejects with no response. */
let snapshotResponse: unknown = listOk([postAction]);
/** Raw-`fetch` calls to the bare packages endpoint — `fetchFullPackage`. */
let snapshotFetches = 0;

beforeEach(() => {
  fetchPackagesMock.mockReset();
  toastError.mockReset();
  snapshotFetches = 0;
  snapshotResponse = listOk([postAction]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      if (String(input) === '/api/v1/packages') {
        snapshotFetches += 1;
        if (snapshotResponse instanceof Error) throw snapshotResponse;
        return snapshotResponse;
      }
      // The pending-drafts counter and the automation status probe.
      return { ok: true, status: 200, json: async () => [] };
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

const trigger = () => screen.getByTestId('studio-pkg-chip');
const where = () => screen.getByTestId('location').textContent;
const sheet = () => screen.queryByTestId('pkg-sheet');
/** The one shared sonner id — one outage across this surface is one toast. */
const toastIdOf = (call: number) =>
  (toastError.mock.calls[call]?.[1] as { id?: string } | undefined)?.id;

/**
 * Open the lifecycle sheet the way the author does — switcher trigger →
 * "Package info & settings" — on the PRE-ACTION record, and hand back its
 * "a lifecycle action ran" button. Every case shares this drive, so the only
 * difference between the pins is what the snapshot refresh answers.
 */
async function openLifecycleSheet(): Promise<HTMLElement> {
  fetchPackagesMock.mockResolvedValue([row(PACKAGE_ID)]);
  snapshotResponse = listOk([preAction]);
  render(
    <MemoryRouter initialEntries={[START_PATH]}>
      <LocationProbe />
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/home" element={<div data-testid="home-page" />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loaded'));
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByText('Package info & settings'));
  const open = await screen.findByTestId('pkg-sheet');
  // The sheet really is showing the pre-action record — the thing the defect
  // then leaves on screen.
  expect(open).toHaveAttribute('data-managed-id', PACKAGE_ID);
  expect(open).toHaveAttribute('data-managed-status', 'active');
  toastError.mockReset();
  return screen.getByTestId('lifecycle-ran');
}

/** Fire the lifecycle action with the HEAD succeeding, so anything reported
 *  afterwards is unambiguously the TAIL's. */
function lifecycleActionRuns(button: HTMLElement): void {
  fetchPackagesMock.mockResolvedValue([row(PACKAGE_ID)]);
  fireEvent.click(button);
}

describe('Studio managed-snapshot refresh — a failed refresh is not a current record (#7907)', () => {
  describe('§1 a 503 SERVICE_UNAVAILABLE envelope on the refresh', () => {
    it('REPORTS it, through this file\'s existing objectui#7368 channel', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listFailure(503, 'SERVICE_UNAVAILABLE', 'Internal server error');
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      // The 5xx band withholds the producer's prose, so the code is the only
      // discriminating word and travels with the generic message — inside a
      // sentence that names what the author can SEE happen (their panel went).
      expect(toastError.mock.calls[0][0]).toBe(
        `Package ${PACKAGE_ID} could not be refreshed after that change — closing the panel rather than showing the pre-change record as current. Internal server error (SERVICE_UNAVAILABLE)`,
      );
      expect(toastIdOf(0)).toBe('studio-package-list');
      // ⛔ One channel, not two: one failure, one report.
      expect(toastError).toHaveBeenCalledTimes(1);
    });

    it('no longer presents the PRE-ACTION record as current', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listFailure(503, 'SERVICE_UNAVAILABLE', 'Internal server error');
      lifecycleActionRuns(lifecycle);

      // The sheet derives its lifecycle VERB from this record, so leaving it
      // open over a snapshot known to be pre-action re-arms the author with
      // the button they just pressed.
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    });

    it('stays a DEGRADATION: the Studio, the top bar and the list are untouched', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listFailure(503, 'SERVICE_UNAVAILABLE', 'Internal server error');
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      // ⛔ No eviction and no throw (objectui#7368 / objectui#7821): a snapshot
      // that could not be read is not evidence of anything about the package.
      expect(where()).toBe(START_PATH);
      expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
      // The HEAD succeeded, so the list is current and still says so.
      expect(trigger()).toHaveAttribute('data-pkg-list-state', 'loaded');
      // Still a working trigger — the failure took nothing else down.
      fireEvent.click(trigger());
      expect(await screen.findByText('Packages (apps)')).toBeInTheDocument();
    });
  });

  describe('§2 the 401 / 403 band — an expired session, and the capability gate', () => {
    it('403 FORBIDDEN: the server\'s own sentence reaches the author', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listFailure(
        403,
        'FORBIDDEN',
        'Reading packages requires the `studio.access` or `setup.access` capability.',
      );
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(toastError.mock.calls[0][0]).toContain(
        'Reading packages requires the `studio.access` or `setup.access` capability. (FORBIDDEN)',
      );
      expect(toastIdOf(0)).toBe('studio-package-list');
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    });

    it('401 UNAUTHENTICATED: reported, and the stale record is not left current', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listFailure(401, 'UNAUTHENTICATED', 'Authentication required');
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(toastError.mock.calls[0][0]).toContain('Authentication required (UNAUTHENTICATED)');
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    });
  });

  describe('§3 a non-JSON error body — the second shape on this path', () => {
    it('names the status instead of a JSON syntax error', async () => {
      // A proxy's HTML 502/504: `res.json()` rejects. This is the ONE arm the
      // pre-objectui#7881 code could reach at all — and this catch swallowed
      // it just the same.
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<html>\"... is not valid JSON");
        },
      };
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(toastError.mock.calls[0][0]).toContain('HTTP 502');
      expect(toastError.mock.calls[0][0]).not.toContain('Unexpected token');
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    });
  });

  describe('§4 no response at all — the transport itself rejects', () => {
    it('reports the transport error and does not leave the stale record current', async () => {
      // Offline / DNS / connection reset: `fetch` rejects, so there is no
      // `res.ok` to read and no envelope to quote. Reachable on this arm
      // precisely because it runs right after a mutating action.
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = new TypeError('Failed to fetch');
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      expect(toastError.mock.calls[0][0]).toContain('Failed to fetch');
      expect(toastIdOf(0)).toBe('studio-package-list');
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
    });
  });

  describe('§5 a SUCCESSFUL refresh whose list no longer contains the package', () => {
    it('says so — `fresh === null` was as silent as the swallowed throw', async () => {
      // The read succeeded, so there is no caught error to format; the package
      // is simply gone. `openManage` refuses to OPEN on this (objectui#7881)
      // and says so with this key — the tail now refuses to KEEP it open, with
      // the same sentence.
      const lifecycle = await openLifecycleSheet();
      // The HEAD must not decide deletion itself, or the tail never runs: it
      // fails, so `list === null` draws no inference (objectui#7821).
      fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
      snapshotResponse = listOk([]);
      fireEvent.click(lifecycle);

      await waitFor(() =>
        expect(
          toastError.mock.calls.some((c) => String(c[0]).includes('is not in the installed list')),
        ).toBe(true),
      );
      const missing = toastError.mock.calls.find((c) =>
        String(c[0]).includes('is not in the installed list'),
      );
      expect(missing?.[0]).toBe(
        `Package ${PACKAGE_ID} is not in the installed list — it may have been deleted or uninstalled elsewhere.`,
      );
      expect((missing?.[1] as { id?: string } | undefined)?.id).toBe('studio-package-list');
      await waitFor(() => expect(sheet()).not.toBeInTheDocument());
      // ⛔ Reporting is not inferring: no eviction is added here (objectui#7821).
      expect(where()).toBe(START_PATH);
      expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();
    });

    it('ONE outage that rejects both halves is still ONE toast', async () => {
      // The head and the tail read the same endpoint, so a single outage
      // rejects both — which is exactly why both report on the shared sonner
      // id. Sonner UPDATES a toast that already carries the id.
      const lifecycle = await openLifecycleSheet();
      fetchPackagesMock.mockRejectedValue(new Error('Service Unavailable'));
      snapshotResponse = listFailure(503, 'SERVICE_UNAVAILABLE', 'Internal server error');
      fireEvent.click(lifecycle);

      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2));
      expect(toastIdOf(0)).toBe('studio-package-list');
      expect(toastIdOf(1)).toBe('studio-package-list');
      // The head's report is the list's; the tail's is the snapshot's.
      expect(toastError.mock.calls[0][0]).toBe('Service Unavailable');
      expect(toastError.mock.calls[1][0]).toContain('could not be refreshed after that change');
    });
  });

  /**
   * ⭐ The negative controls. These pass with the fix REVERTED, which is what
   * proves the pins above are not restating an existing assertion — and they
   * are what a degenerate "just close the sheet" fix cannot pass.
   */
  describe('§6 negative control — a genuinely successful refresh', () => {
    it('updates the sheet in place, exactly as before', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listOk([postAction]);
      lifecycleActionRuns(lifecycle);

      // The whole point of the tail: the disable the author just fired shows
      // immediately. ⛔ A fix that closed the sheet unconditionally dies here.
      await waitFor(() => expect(sheet()).toHaveAttribute('data-managed-status', 'disabled'));
      expect(sheet()).toHaveAttribute('data-managed-enabled', 'false');
      expect(sheet()).toHaveAttribute('data-managed-id', PACKAGE_ID);
    });

    it('reports nothing — a success is not an outage', async () => {
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = listOk([postAction]);
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(sheet()).toHaveAttribute('data-managed-status', 'disabled'));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('reads the BARE-ARRAY body the same endpoint also serves', async () => {
      // `root = data.data ?? data` — the reader accepts the wrapped envelope
      // and a bare array, and this card changes neither.
      const lifecycle = await openLifecycleSheet();
      snapshotResponse = { ok: true, status: 200, json: async () => [postAction] };
      lifecycleActionRuns(lifecycle);

      await waitFor(() => expect(sheet()).toHaveAttribute('data-managed-status', 'disabled'));
      expect(toastError).not.toHaveBeenCalled();
    });

    it('a REAL deletion still evicts, unchanged (the head\'s decision — objectui#7821)', async () => {
      // The list came back successfully WITHOUT the package: that is the one
      // evidence of deletion, it belongs to the head, and the tail never runs.
      const lifecycle = await openLifecycleSheet();
      fetchPackagesMock.mockResolvedValue([]);
      const before = snapshotFetches;
      fireEvent.click(lifecycle);

      expect(await screen.findByTestId('home-page')).toBeInTheDocument();
      expect(where()).toBe('/home');
      expect(snapshotFetches).toBe(before);
      expect(toastError).not.toHaveBeenCalled();
    });
  });
});
