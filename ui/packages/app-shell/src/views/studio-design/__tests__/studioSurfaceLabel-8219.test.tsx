// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8219 item 3 — the Studio copilot hands the chat pane the display
 * label of what the user is discussing, as a SEPARATE optional prop.
 *
 * The label lives only in the Interfaces pillar (its open leaf), which reports
 * it up to the surface that mounts the dock. The conversation passes it on only
 * when it names the SAME artifact the URL does — the URL stays the single
 * source of the surface context (cloud#1610), so a label that lags or leads the
 * `?surface=` deep-link is dropped rather than shown against the wrong item.
 *
 * The other half is the invariant seat answer A rests on: `surfaceContext`, the
 * `context.surface` data the agent receives, is identical with and without a
 * label. The conversations double below is the one `studioSurfaceContext.test.tsx`
 * carries, for the same reason (objectui#7307).
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
 * Copied from `studioSurfaceContext.test.tsx`, whose header explains it: the
 * real conversation mints (POST) and then resumes (GET) one thread through the
 * global `fetch`, so both routes are served and any other URL fails the case.
 * ─────────────────────────────────────────────────── */

/** The one thread this fake server owns: minted once, resumed thereafter. */
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

const DASH = { type: 'dashboard', name: 'customer_dashboard', label: '客户仪表盘' };

function renderAt(url: string, surfaceLabel?: { type: string; name: string; label: string }) {
  // Spread so the file compiles against a conversation that does not declare
  // the prop yet (the red half).
  const labelProp = (surfaceLabel ? { surfaceLabel } : {}) as Record<string, never>;
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/studio/:packageId/:tab"
          element={<StudioCopilotConversation packageId="app.k9" {...labelProp} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const URL_DASH = '/studio/app.k9/interfaces?surface=dashboard:customer_dashboard';

describe('Studio copilot display label (objectui#8219 item 3)', () => {
  it('a label for the artifact the URL names reaches the pane as its own prop', () => {
    renderAt(URL_DASH, DASH);
    expect(capturedProps.surfaceArtifactLabel).toBe('客户仪表盘');
  });

  it('surfaceContext is byte-identical with and without the label', () => {
    renderAt(URL_DASH);
    const without = JSON.stringify(capturedProps.surfaceContext);
    expect(capturedProps.surfaceArtifactLabel).toBeUndefined();
    cleanup();
    renderAt(URL_DASH, DASH);
    expect(JSON.stringify(capturedProps.surfaceContext)).toBe(without);
    expect(without).toBe(
      JSON.stringify({ pillar: 'interfaces', artifact: { type: 'dashboard', name: 'customer_dashboard' } }),
    );
  });

  it('a label for a DIFFERENT artifact than the URL names is not shown', () => {
    renderAt('/studio/app.k9/interfaces?surface=object:b2r4_customer', DASH);
    expect(capturedProps.surfaceArtifactLabel).toBeUndefined();
  });

  it('no artifact in the URL: no label, whatever was reported', () => {
    renderAt('/studio/app.k9/data', DASH);
    expect(capturedProps.surfaceArtifactLabel).toBeUndefined();
  });
});
