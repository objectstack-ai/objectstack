// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7938 — `fetchFullPackage` read `error.message` and `error.code` and
 * stopped, so a producer-marked `error.userMessage` arrived on the wire and had
 * nowhere to appear.
 *
 * ## The field is MEASURED to arrive, not assumed
 *
 * `GET /api/v1/packages` is served by the direct-mount registrar
 * (`@objectstack/rest` `package-routes.ts`), whose `sendThrownError` spreads
 * the marked channel onto the wire beside `details` and `declaredCode`:
 *
 *     const extra = {
 *       ...(thrown.details ? { details: thrown.details } : {}),
 *       ...(declaredCode !== undefined ? { declaredCode } : {}),
 *       ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
 *     };
 *
 * and `sendError` (`@objectstack/types` `response-envelope.ts`) nests that
 * whole object under `error`:
 *
 *     res.status(status).json({ success: false, error: { code, message, ...extra } });
 *
 * — which is exactly the `error.userMessage` path these pins drive.
 *
 * ## Why the 5xx band is where it bites
 *
 * The same door withholds the producer's PROSE above:
 *
 *     const message = thrown.status >= 500 && looksLikeInternalErrorLeak(thrown.message)
 *       ? INTERNAL_ERROR_MESSAGE
 *       : thrown.message;
 *
 * The withhold rewrites a LOCAL `message` const and `looksLikeInternalErrorLeak`
 * is only ever handed `thrown.message`, so `thrown.userMessage` is never an
 * input to it — the marked text rides through a sanitised 500 untouched. That
 * door's own note states the rule: "a marked text is the producer's deliberate
 * statement to the caller at any status", and the framework pins the pair in
 * `packages/rest/src/package-door-user-message.test.ts` §4, which asserts
 * `error.message === INTERNAL_ERROR_MESSAGE` and the marked text intact on the
 * same body.
 *
 * So on a marked 500/503 this reader showed the author the GENERIC sentence and
 * silently dropped the SPECIFIC one written for them. Nothing invalid was
 * displayed — the toast was correct, just generic — which is exactly what made
 * the loss quiet.
 *
 * ## Three combinations, because two of the three were never the failing case
 *
 * Both fields are optional and independent, so §1-§3 drive all three reachable
 * combinations rather than only the one that motivated the card:
 *
 *   §1 `message` only        — the overwhelmingly common unmarked refusal.
 *                              Byte-identical output before and after. GREEN
 *                              with the fix reverted, deliberately: this is the
 *                              pin that stops "prefer `userMessage`" from being
 *                              implemented as "read `userMessage` INSTEAD".
 *   §2 `userMessage` only    — the marked text is the only prose on the body.
 *                              Was `HTTP 503`; the author now reads the
 *                              sentence written for them. Its two words-pins go
 *                              RED when reverted; its third case asserts the
 *                              report CHANNEL and stays green either way.
 *   §3 both                  — the live 5xx case. Was the generic sentence;
 *                              now the marked one. RED when reverted.
 *
 * §4 pins how `code` composes across those combinations — it is appended to
 * whichever prose won, and rescues neither the empty case nor a non-string
 * mark. §5 drives the SECOND caller of this shared read (the managed-snapshot
 * refresh, objectui#7907's tail) so the fix is shown reaching both, not one.
 * §6 is the negative control: a successful read is untouched.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';
const START_PATH = `/studio/${PACKAGE_ID}/interfaces`;

const row = (id: string) => ({ id, name: id, writable: true, namespace: id.split('.')[1] });

/**
 * The package LIST read — the mount effect, the writability courtesy gate and
 * the namespace lookup all share it, and it goes through `packages-io`'s
 * `fetchPackages`, NOT through `fetchFullPackage`. Held open and succeeding in
 * every case here so the raw `fetch` mock below belongs to `fetchFullPackage`
 * alone: it is the reader under test.
 */
const fetchPackagesMock = vi.fn();
vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchPackages: (...args: unknown[]) => fetchPackagesMock(...args) };
});

// The report channel (this surface's existing objectui#7368 posture). Captured
// rather than rendered so a pin can read both the words and the shared id.
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
 * The sheet renders on `open` alone (the real one returns `null` for a null
 * `pkg`, which would make "opened over nothing" and "not opened" identical),
 * and exposes `onChanged` so §5 can fire a lifecycle action and drive the
 * managed-snapshot refresh — `fetchFullPackage`'s second caller.
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

// jsdom ships neither; useIsMobile / useIsWideViewport and the Radix popover's
// floating-ui measurement need them.
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

/** The success shape: `sendOk` wraps the handler's `{ packages, total }`. */
const listOk = (packages: unknown[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: { packages, total: packages.length } }),
});

/**
 * A failure envelope exactly as `sendError` writes it — `{ code, message,
 * ...extra }` under `error`. `extra` is spread verbatim so a case can put a
 * marked text on the body, omit `message` entirely, or send a non-string mark.
 */
const listFailure = (status: number, body: Record<string, unknown>) => ({
  ok: false,
  status,
  json: async () => ({ success: false, error: body }),
});

/** The generic sentence the 5xx prose withhold substitutes (`INTERNAL_ERROR_MESSAGE`). */
const GENERIC = 'Internal server error';
/** A producer's marked text: what `userMessage` carries, written for the author. */
const MARKED = 'Publishing is temporarily unavailable. Nothing was changed.';

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
/** The one shared sonner id — one outage across this surface is one toast. */
const toastId = () => (toastError.mock.calls[0]?.[1] as { id?: string } | undefined)?.id;

/**
 * Drive the FIRST caller the way the author does — switcher trigger →
 * "Package info & settings" — so the only difference between the cases is what
 * the lookup answers.
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
 * Wait until `openManage` has SETTLED whichever way it goes — it either
 * reported or opened the sheet — so the assertions are not racing a pending
 * promise and a red lands on the defect rather than on a timeout.
 */
async function settled(): Promise<void> {
  await waitFor(() =>
    expect(toastError.mock.calls.length > 0 || screen.queryByTestId('pkg-sheet') !== null).toBe(true),
  );
}

/** What the author is shown, once the lookup answered `body` at `status`. */
async function reportedFor(status: number, body: Record<string, unknown>): Promise<string> {
  lookupResponse = listFailure(status, body);
  await clickManage();
  await settled();
  expect(toastError).toHaveBeenCalled();
  return toastError.mock.calls[0][0] as string;
}

describe('Studio package lookup — a producer-marked userMessage reaches the author (#7938)', () => {
  /**
   * ⭐ GREEN with the fix reverted, and load-bearing for that reason. The
   * unmarked refusal is the overwhelmingly common case, and this is the pin
   * that stops "prefer `userMessage`" from being implemented as "read
   * `userMessage` instead of `message`" — which would have blanked every
   * refusal the platform serves today.
   */
  describe('§1 `message` only — the unmarked refusal, unchanged', () => {
    it('renders the diagnostic prose with its code, byte for byte as before', async () => {
      expect(
        await reportedFor(403, {
          code: 'FORBIDDEN',
          message: 'Reading packages requires the `studio.access` or `setup.access` capability.',
        }),
      ).toBe('Reading packages requires the `studio.access` or `setup.access` capability. (FORBIDDEN)');
      expect(toastId()).toBe('studio-package-list');
    });

    it('does not open the sheet — objectui#7881\'s refusal still holds', async () => {
      await reportedFor(503, { code: 'SERVICE_UNAVAILABLE', message: GENERIC });
      expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument();
    });
  });

  /**
   * The marked text is the ONLY prose on the body. `sendError` requires a
   * `message` argument, so this shape reaches a browser as a body whose
   * `message` is absent or non-string (a hand-written intermediary, a
   * generation that predates the field) — and the pre-fix ladder answered it
   * with the bare status, discarding a sentence it was holding.
   */
  describe('§2 `userMessage` only — the mark is the only prose', () => {
    it('renders the marked text instead of the bare status', async () => {
      expect(await reportedFor(503, { code: 'SERVICE_UNAVAILABLE', userMessage: MARKED })).toBe(
        `${MARKED} (SERVICE_UNAVAILABLE)`,
      );
    });

    it('⛔ never falls back to `HTTP <status>` when a mark is present', async () => {
      const shown = await reportedFor(503, { code: 'SERVICE_UNAVAILABLE', userMessage: MARKED });
      expect(shown).not.toBe('HTTP 503');
      expect(shown).toContain(MARKED);
    });

    /**
     * ⭐ GREEN with the fix reverted, deliberately — measured, not predicted:
     * this asserts the CHANNEL (objectui#7368's posture — one outage, one
     * toast, one id), not the words, and reverting changes only the words. It
     * is here because a fix that reached for a second reporting channel to
     * carry the marked text would pass every words-pin above and fail here.
     */
    it('reports once, on the shared sonner id', async () => {
      await reportedFor(500, { code: 'INTERNAL_ERROR', userMessage: MARKED });
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(toastId()).toBe('studio-package-list');
    });
  });

  /**
   * ⭐ The case that motivated the card, and the one the framework pins on its
   * own side (`package-door-user-message.test.ts` §4): a sanitised 500 whose
   * `message` is the generic sentence and whose `userMessage` rode through.
   */
  describe('§3 both — the 5xx band, where the loss was visible', () => {
    it('shows the MARKED sentence, not the generic substitution', async () => {
      expect(await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED })).toBe(
        `${MARKED} (INTERNAL_ERROR)`,
      );
    });

    it('⛔ the generic sentence does not also appear — it is displaced, not appended', async () => {
      const shown = await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED });
      expect(shown).not.toContain(GENERIC);
    });

    /**
     * ⛔ NOT scoped to 5xx. The producing door applies no status condition to
     * this channel — "a marked text is the producer's deliberate statement to
     * the caller at any status" — so a consumer that honoured it in one band
     * only would re-create on the reading end the divergence that door refused
     * to create on the writing end.
     */
    it('prefers the mark in the 4xx band too, where `message` was never withheld', async () => {
      expect(
        await reportedFor(409, {
          code: 'RESOURCE_CONFLICT',
          message: 'version 1.2.0 already published for app.b2r4',
          userMessage: 'That version is already published. Bump the version and retry.',
        }),
      ).toBe('That version is already published. Bump the version and retry. (RESOURCE_CONFLICT)');
    });
  });

  /**
   * `code` is orthogonal to which prose won: it is appended to whichever
   * sentence is rendered, and it never rescues a body that carried no prose at
   * all. The last two cases are the reason the read is a typed `string` check
   * rather than a truthiness one.
   */
  describe('§4 how `code` composes across the three combinations', () => {
    it('a marked body with NO code renders the bare sentence', async () => {
      expect(await reportedFor(503, { message: GENERIC, userMessage: MARKED })).toBe(MARKED);
    });

    it('neither prose, code present — still the status, and the code is NOT it', async () => {
      // Unchanged: a code alone is not a sentence to show an author.
      expect(await reportedFor(503, { code: 'SERVICE_UNAVAILABLE' })).toBe('HTTP 503');
    });

    it('a non-string `userMessage` is not a mark — it falls through to `message`', async () => {
      expect(await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: 42 })).toBe(
        `${GENERIC} (INTERNAL_ERROR)`,
      );
    });

    it('an empty-string `userMessage` is not a mark either', async () => {
      // The producer's `declaredUserMessage` already applies this rule, so an
      // empty mark should never ship — the reader does not depend on that.
      expect(await reportedFor(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: '' })).toBe(
        `${GENERIC} (INTERNAL_ERROR)`,
      );
    });
  });

  /**
   * ⭐ The read is SHARED. `fetchFullPackage` has two callers — `openManage`
   * (§1-§4 above) and the TAIL of `onManageChanged`, the managed-snapshot
   * refresh objectui#7907 taught to report and close. Fixing the reader fixes
   * both; this drives the second so that is shown rather than assumed.
   */
  describe('§5 the second caller — the managed-snapshot refresh (objectui#7907\'s tail)', () => {
    it('carries the marked sentence into the refresh-failed report, and closes the panel', async () => {
      lookupResponse = listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID } }]);
      await clickManage();
      expect(await screen.findByTestId('pkg-sheet')).toHaveAttribute('data-managed-id', PACKAGE_ID);
      toastError.mockReset();

      // A lifecycle action runs; the snapshot refresh meets a marked 500.
      fetchPackagesMock.mockResolvedValue([row(PACKAGE_ID)]);
      lookupResponse = listFailure(500, { code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED });
      fireEvent.click(screen.getByTestId('lifecycle-ran'));

      await waitFor(() => expect(toastError).toHaveBeenCalled());
      const shown = toastError.mock.calls[0][0] as string;
      // objectui#7907's key, carrying the server's own words inside it — ⛔ one
      // mechanism, not a second reporting channel for this card.
      expect(shown).toContain(`Package ${PACKAGE_ID} could not be refreshed after that change`);
      expect(shown).toContain(`${MARKED} (INTERNAL_ERROR)`);
      expect(shown).not.toContain(GENERIC);
      expect(toastId()).toBe('studio-package-list');
      await waitFor(() => expect(screen.queryByTestId('pkg-sheet')).not.toBeInTheDocument());
    });
  });

  /**
   * ⭐ Negative controls — GREEN with the fix reverted. Without them a "fix"
   * that reported on every read, or stopped opening the sheet at all, would
   * satisfy every assertion above.
   */
  describe('§6 negative control — a successful lookup is untouched', () => {
    it('opens the sheet on the real package and reports nothing', async () => {
      lookupResponse = listOk([{ manifest: { id: PACKAGE_ID, name: PACKAGE_ID }, writable: true }]);
      await clickManage();

      expect(await screen.findByTestId('pkg-sheet')).toHaveAttribute('data-managed-id', PACKAGE_ID);
      expect(toastError).not.toHaveBeenCalled();
    });

    it('a non-JSON error body still names the status (objectui#7881 §4)', async () => {
      lookupResponse = {
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError("Unexpected token '<', \"<html>\"... is not valid JSON");
        },
      };
      await clickManage();
      await settled();
      expect(toastError.mock.calls[0][0]).toBe('HTTP 502');
    });
  });
});
