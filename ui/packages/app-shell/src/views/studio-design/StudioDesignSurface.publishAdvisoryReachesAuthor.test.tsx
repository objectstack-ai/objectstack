// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10039 — a per-draft advisory the SERVER sent must reach the author
 * on THIS surface, the Studio workbench's package-level publish.
 *
 * ## What this asserts, and what would be worthless
 *
 * The defect is that the findings VANISH, not that some particular function
 * was skipped. So this fires the workbench's own publish action, answers it
 * with the batch body the framework's runtime authoring gate actually sends
 * (advisories riding each `published[]` element, objectstack#9343), and
 * asserts the finding's own prose arrives at the console's advisory sink.
 *
 * ## Real vs stubbed
 *
 * Real: the surface, `useMetadataClient` — ⛔ deliberately NOT mocked, which is
 * the whole point: mocking that hook is precisely how this class of hole stays
 * invisible (see `../metadata-admin/useMetadataClient.advisorySink.test.tsx`)
 * — the client, its `published[]` walk, `readSaveAdvisories` and
 * `emitSaveAdvisories`.
 *
 * Stubbed: `sonner` (the terminal sink, a module binding), `globalThis.fetch`
 * (the server), `packages-io`'s package list, and `DraftChangesPanel` — the
 * review sheet is the surface's own affordance for REACHING publish and not
 * what is under test, so it is reduced to the button that fires `onPublish`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.b2r4';

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock('./packages-io', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchPackages: vi.fn(async () => [
      { id: PACKAGE_ID, name: PACKAGE_ID, writable: true, namespace: 'b2r4' },
    ]),
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
vi.mock('../../preview/DraftChangesPanel', () => ({
  DraftChangesPanel: ({ onPublish }: { onPublish?: () => void | Promise<void> }) =>
    onPublish ? (
      <button type="button" data-testid="publish-all-drafts" onClick={() => void onPublish()}>
        publish
      </button>
    ) : null,
}));

import { toast } from 'sonner';
import { StudioDesignSurface } from './StudioDesignSurface';

// jsdom/happy-dom ship neither; useIsMobile / useIsWideViewport and the Radix
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

/**
 * One finding in the gate's D3 shape. All six keys are required —
 * `readSaveAdvisories` drops a half-shaped finding, so a fixture missing one
 * would make this file pass (or fail) for the wrong reason.
 */
const PURGE_ADVISORY = {
  severity: 'warning' as const,
  rule: 'flow/delete-without-filter',
  where: 'flow "nightly_purge" · node "purge old rows"',
  path: 'flows[0].nodes[2].config.filters',
  message: 'this delete_record node sets multi: true with no filter, so it deletes every row',
  hint: 'add a filter, or set multi: false to delete a single record',
};

/** The batch body in the envelope `PublishPackageDraftsResponseSchema` declares. */
const ADVISED_BATCH = {
  success: true,
  data: {
    outcome: 'published',
    publishedCount: 1,
    failedCount: 0,
    published: [{ type: 'flow', name: 'nightly_purge', advisories: [PURGE_ADVISORY] }],
    failed: [],
  },
};

/** The same publish, clean: the server omits `advisories` entirely. */
const CLEAN_BATCH = {
  success: true,
  data: {
    outcome: 'published',
    publishedCount: 1,
    failedCount: 0,
    published: [{ type: 'flow', name: 'nightly_purge' }],
    failed: [],
  },
};

let batchBody: unknown = ADVISED_BATCH;
let publishPosts = 0;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  batchBody = ADVISED_BATCH;
  publishPosts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/publish-drafts')) {
        publishPosts += 1;
        return json(batchBody);
      }
      // Every other read this surface makes (drafts count, type registry,
      // pillar lists) answers empty — none of them is under test here.
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the workbench and fire its package-level publish. */
async function publishFromTheWorkbench(): Promise<void> {
  render(
    <MemoryRouter initialEntries={[`/studio/${PACKAGE_ID}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('publish-all-drafts'));
  await waitFor(() => expect(publishPosts).toBe(1));
}

describe('StudioDesignSurface — the server’s advisory reaches the author (objectui#10039)', () => {
  it('renders the finding the batch publish answered with', async () => {
    await publishFromTheWorkbench();

    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [title, options] = vi.mocked(toast.warning).mock.calls[0] as [
      string,
      { description?: string } | undefined,
    ];
    expect(title).toMatch(/^Published\b/);
    expect(options?.description).toContain(PURGE_ADVISORY.message);
    expect(options?.description).toContain(PURGE_ADVISORY.rule);
    expect(options?.description).toContain(PURGE_ADVISORY.hint);
  });

  it('CONTROL: a clean publish says nothing, and the same drive really ran', async () => {
    batchBody = CLEAN_BATCH;
    await publishFromTheWorkbench();

    expect(publishPosts).toBe(1);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
