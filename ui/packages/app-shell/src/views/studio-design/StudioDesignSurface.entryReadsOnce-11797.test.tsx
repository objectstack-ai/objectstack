/**
 * objectui#11797 — opening a package reads the package list once and the
 * pending-drafts ledger once.
 *
 * The REAL surface on its Data tab, with the REAL `fetchPackages` and the REAL
 * `usePendingDrafts`, over a stubbed `fetch` that counts requests on the wire.
 * Three readers of `GET /api/v1/packages` mount here at once — the package
 * switcher, the writability courtesy gate and `DataPillar`'s namespace lookup
 * — and the top bar reads the drafts ledger both from the hook and from its
 * own publish/draft-nonce effect. Each of those used to send its own request.
 *
 * The package list is HELD until every mount effect has run, so the count
 * says how many requests the readers made while one was already pending —
 * the situation on a real network, where the first answer has not arrived by
 * the time the last reader mounts. The drafts ledger is held the same way.
 *
 * The chat dock is stubbed as in the sibling surface pins; its own drafts
 * reads (the chat bar) are pinned by `usePendingDrafts.inflightShare-11797`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';
const PACKAGES_URL = '/api/v1/packages';
const DRAFTS_URL = `/api/v1/meta/_drafts?packageId=${PACKAGE_ID}`;

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
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

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';

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

interface Held {
  url: string;
  release: () => void;
}

let held: Held[] = [];
let requested: string[] = [];

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  held = [];
  requested = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown, init?: { method?: string }) => {
      const url = String(input);
      if ((init?.method ?? 'GET').toUpperCase() === 'GET') requested.push(url);
      if (url === PACKAGES_URL) {
        return new Promise((resolve) => {
          held.push({
            url,
            release: () =>
              resolve(
                answer({
                  success: true,
                  data: { packages: [{ manifest: { id: PACKAGE_ID, name: 'Field Ops' }, writable: true }] },
                }),
              ),
          });
        });
      }
      if (url === DRAFTS_URL) {
        return new Promise((resolve) => {
          held.push({ url, release: () => resolve(answer([])) });
        });
      }
      // The automation status probe and the other incidental reads.
      return Promise.resolve(answer([]));
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function drain() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
}

const onWire = (url: string) => requested.filter((u) => u === url).length;

describe('StudioDesignSurface — entry reads each question once (objectui#11797)', () => {
  it('opening a package on its Data tab sends one package-list read and one drafts-ledger read', async () => {
    render(
      <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/data`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>,
    );
    await act(drain);

    expect(onWire(PACKAGES_URL)).toBe(1);
    expect(onWire(DRAFTS_URL)).toBe(1);

    // Every reader that shared the one request still gets the answer.
    await act(async () => {
      for (const h of held) h.release();
      await drain();
    });
    await waitFor(() =>
      expect(screen.getByTestId('studio-pkg-chip')).toHaveAttribute('data-pkg-list-state', 'loaded'),
    );
    expect(screen.getByTestId('studio-pkg-chip')).toHaveTextContent('Field Ops');
  });
});
