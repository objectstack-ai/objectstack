/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10039 — a per-draft advisory the SERVER sent must reach the author
 * on THIS surface, the chat transcript's draft-card Publish.
 *
 * ## What this asserts, and what would be worthless
 *
 * The defect is that the findings VANISH. So this fires the handler the chat
 * cards fire (`onPublishDrafts`), answers it with the batch body the
 * framework's runtime authoring gate actually sends (advisories riding each
 * `published[]` element, objectstack#9343), and asserts the finding's own
 * prose arrives at the console's advisory sink.
 *
 * ## Real vs stubbed
 *
 * Real: `ChatPane`'s publish handler, `useMetadataClient` — ⛔ deliberately NOT
 * mocked (see `../../views/metadata-admin/useMetadataClient.advisorySink.test.tsx`
 * for why mocking it is how this class of hole stays invisible) — the client,
 * its `published[]` walk, `readSaveAdvisories`, `emitSaveAdvisories`, and the
 * REAL `publishHealthFromResponse` the handler hands back to the chat card.
 *
 * Stubbed: `sonner` (the terminal sink, a module binding), `globalThis.fetch`
 * (the server), and the chat tree itself — `ChatbotEnhanced` is the CONSUMER
 * of the handler under test, not the handler, so it is reduced to the button
 * that fires it.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PACKAGE_ID = 'app.k9qk';

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

/** What the chat card's Publish handed back — captured so the ADR-0038 L3
 *  health hand-off is observed along with the advisory. */
let publishResult: unknown;

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: () => ({
      messages: [],
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      const onPublishDrafts = props.onPublishDrafts as
        | ((packageId: string) => Promise<unknown>)
        | undefined;
      return (
        <button
          type="button"
          data-testid="card-publish"
          onClick={() => {
            void (async () => {
              publishResult = await onPublishDrafts?.(PACKAGE_ID);
            })();
          }}
        >
          publish
        </button>
      );
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../LiveCanvas', () => ({ LiveCanvas: () => <div data-testid="live-canvas" /> }));

import { toast } from 'sonner';
import { AiChatPage } from '../AiChatPage';

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
  publishResult = undefined;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/publish-drafts')) {
        publishPosts += 1;
        return json(batchBody);
      }
      return json({ success: true, data: [] });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Render the build surface and fire a draft card's Publish. */
async function publishFromAChatCard(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/ai/build']}>
      <Routes>
        <Route path="/ai/:agent" element={<AiChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId('card-publish'));
  await waitFor(() => expect(publishPosts).toBe(1));
}

describe('AiChatPage — the server’s advisory reaches the author (objectui#10039)', () => {
  it('renders the finding the batch publish answered with', async () => {
    await publishFromAChatCard();

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

  it('CONTROL: a clean publish says nothing, and the card still gets its verdict', async () => {
    batchBody = CLEAN_BATCH;
    await publishFromAChatCard();

    expect(publishPosts).toBe(1);
    // The handler's own contract with the chat card is unchanged — this is
    // what makes the silence above a reading about the advisory list rather
    // than about a handler that stopped working.
    await waitFor(() => expect(publishResult).toMatchObject({ ok: true }));
    expect(toast.warning).not.toHaveBeenCalled();
  });
});
