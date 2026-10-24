// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#1610 (send half) — the Studio copilot derives WHAT the user is
 * discussing from the URL alone: the `:tab` route segment is the pillar, the
 * `?surface=type:name` deep-link (which every pillar already mirrors) is the
 * artifact WITH its type discriminator. Pinned by rendering the real
 * StudioCopilotConversation and asserting the surfaceContext it hands the
 * ChatPane — the URL is the single source of truth, so this contract is
 * exactly "route in → context out".
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let capturedProps: Record<string, unknown> = {};

vi.mock('../../../console/ai/AiChatPage.js', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    ChatPane: (props: Record<string, unknown>) => {
      capturedProps = props;
      return <div data-testid="pane" />;
    },
  };
});
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAgents: () => ({
      agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
      isLoading: false,
      loading: false,
      error: undefined,
      refetch: vi.fn(),
    }),
  };
});

import { StudioCopilotConversation } from '../StudioAiCopilot';

/* ── The `ai/conversations` double (objectui#7307) ────────────────────
 * Every `renderAt` below mounts the real `StudioCopilotConversation`, whose
 * `useChatConversation` resolve effect mints a thread for the signed-in user on
 * mount: `POST /api/v1/ai/conversations` through the GLOBAL `fetch`
 * (`hooks/useChatConversation.ts:609`, no `apiFetch` seam on the path). Under
 * happy-dom that global is a real HTTP client and the document URL defaults to
 * `http://localhost:3000`, so the relative path resolved to a live socket — once
 * per case, four in the file. The resolve's `catch` is deliberately conservative
 * (it keeps the surface as it was), which is why these cases stayed green while
 * the mint always failed.
 *
 * Answered from a RECORDING double — the shape objectui#5225 settled on, carried
 * by `packages/plugin-report/src/__tests__/DatasetReportRenderer.test.tsx` and by
 * this burn-down's earlier batches. Deliberately NOT a blanket network stub: it
 * records every URL it is handed and `afterEach` fails on any URL outside the
 * routes it serves.
 *
 * TWO routes, because a mint that SUCCEEDS is resumable and the hook resumes it.
 * `useChatConversation` caches the minted id in `localStorage`
 * (`writeCache` → `readCache`), and happy-dom keeps that store for the whole
 * file — so case 1 mints and cases 2-4 resume, reading
 * `GET /api/v1/ai/conversations/{THE_MINTED_ID}` instead. That second route was
 * MEASURED, not assumed: serving only the mint made this file's own
 * router assertion red naming that exact URL. Both answer the same empty
 * `ServerConversation` (`{ id, messages: [] }` — the shape `createConversation`
 * and `fetchConversation` both cast their body to), so the fake server is
 * self-consistent: one thread, minted once, resumed thereafter.
 *
 * Why an empty thread changes no assertion here: this file asserts ONE thing per
 * case — the `surfaceContext` prop the pane receives, derived from the URL alone.
 * `ChatPane` is a capture stub, the conversation never reaches an assertion, and
 * the resolve settles in a microtask AFTER each synchronous case body has already
 * read `capturedProps`. A SEEDED thread would hydrate `initialMessages` into that
 * same stub for no assertion's benefit. Routes are matched on the PATHNAME; the
 * full URL is what gets recorded.
 * ─────────────────────────────────────────────────── */

/** The one thread this fake server owns: minted by case 1, resumed by 2-4. */
const CONVERSATION = { id: 'conv_studio_copilot', messages: [] as unknown[] };

/** `POST` here mints; `GET .../{id}` resumes. Nothing else is served. */
const MINT_ROUTE = '/api/v1/ai/conversations';
const RESUME_ROUTE = `${MINT_ROUTE}/${CONVERSATION.id}`;
const SERVED_ROUTES = new Set([MINT_ROUTE, RESUME_ROUTE]);

/** Every URL this file's renders handed the global `fetch`, in request order. */
let aiCalls: string[] = [];

/** The route key of a recorded URL: its pathname, without any query. */
const routeOf = (url: string) => url.split('?')[0];

/** Serve the two conversation routes as one empty thread; record everything. */
function installConversationsDouble() {
  aiCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(
        input && typeof input === 'object' && 'url' in input ? (input as { url: unknown }).url : input,
      );
      aiCalls.push(url);
      if (!SERVED_ROUTES.has(routeOf(url))) {
        return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
      }
      return { ok: true, status: 200, headers: new Headers(), json: async () => CONVERSATION };
    }),
  );
}

beforeEach(installConversationsDouble);

afterEach(() => {
  // The double is a router, not a sink: an escape to any OTHER endpoint fails
  // here instead of vanishing into the resolve effect's `catch`.
  expect(aiCalls.filter((url) => !SERVED_ROUTES.has(routeOf(url)))).toEqual([]);
  // Unmount BEFORE restoring the real `fetch`. Vitest runs `afterEach` hooks in
  // reverse registration order, so this file's teardown runs before the root
  // setup's RTL cleanup: unstubbing first would leave the tree mounted with the
  // real global back in place, and a mount effect settling in that window
  // escapes again (objectui#7439).
  cleanup();
  vi.unstubAllGlobals();
  capturedProps = {};
});

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/studio/:packageId/:tab"
          element={<StudioCopilotConversation packageId="app.k9" />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Studio copilot surfaceContext (cloud#1610 send half)', () => {
  it('pillar + typed artifact come straight from the URL', () => {
    renderAt('/studio/app.k9/interfaces?surface=dashboard:sales_overview');
    expect(capturedProps.surfaceContext).toEqual({
      pillar: 'interfaces',
      artifact: { type: 'dashboard', name: 'sales_overview' },
    });
  });

  it('a pillar with no selected artifact still names the pillar', () => {
    renderAt('/studio/app.k9/data');
    expect(capturedProps.surfaceContext).toEqual({ pillar: 'data' });
  });

  it('an artifact name containing colons keeps everything after the FIRST one', () => {
    renderAt('/studio/app.k9/interfaces?surface=object:k9_task.member_list');
    expect(capturedProps.surfaceContext).toEqual({
      pillar: 'interfaces',
      artifact: { type: 'object', name: 'k9_task.member_list' },
    });
  });

  it('a malformed surface param degrades to pillar-only, never a broken artifact', () => {
    renderAt('/studio/app.k9/access?surface=nonsense');
    expect(capturedProps.surfaceContext).toEqual({ pillar: 'access' });
  });
});
